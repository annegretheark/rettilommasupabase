// Supabase Edge Function: daglig-appfaktura
// Sjekker prøveperiode daglig. Lager 0 kr-faktura i Storage hver dag i prøveperioden.
// Når 30 dager er passert, lager den én abonnementsfaktura per måned på 400 kr + mva.
// Fakturafil lagres i Storage bucket: hov-firma-faktura
// Path: hovslager/fakturaer/<firma_id>/YYYY/MM/<fakturanr>.pdf
// Avsender hentes alltid fra firmaet med e-post greknuts@online.no.
// Greknuts brukes som sysadm/avsender og blir ikke fakturert som kunde.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BUCKET = 'hov-firma-faktura'
const FOLDER = 'hovslager/fakturaer'
const STORAGE_FOLDER_LABEL = 'hov-firma-faktura/hovslager/fakturaer'
const DEFAULT_EKS_MVA = 400
const DEFAULT_MVA = 25
const TRIAL_DAYS = 30
const SYSADM_EMAIL = 'greknuts@online.no'


const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function isoDate(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

function addDays(dateText: string, days: number): string {
  const d = new Date(dateText + 'T00:00:00.000Z')
  d.setUTCDate(d.getUTCDate() + days)
  return isoDate(d)
}

function daysBetween(start: string, end: string): number {
  const a = new Date(start + 'T00:00:00.000Z').getTime()
  const b = new Date(end + 'T00:00:00.000Z').getTime()
  return Math.floor((b - a) / 86400000)
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string))
}

function kr(v: number): string {
  return new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0))
}

function monthKey(dateText: string): string {
  return String(dateText || isoDate()).slice(0, 7)
}

async function ensureBucket() {
  const { error } = await sb.storage.getBucket(BUCKET)
  if (!error) return
  const created = await sb.storage.createBucket(BUCKET, { public: true })
  if (created.error && !String(created.error.message || '').toLowerCase().includes('already exists')) {
    throw created.error
  }
}


function isSysadmFirma(firma: any): boolean {
  return String(firma?.epost ?? '').trim().toLowerCase() === SYSADM_EMAIL
}

async function getGreknutsSenderFirma(): Promise<any | null> {
  const { data, error } = await sb
    .from('hov_firma')
    .select('*')
    .ilike('epost', SYSADM_EMAIL)
    .maybeSingle()
  if (error) {
    console.warn('Kunne ikke hente Greknuts avsenderfirma', error)
    return null
  }
  return data ?? null
}

function senderLine(sender: any, key: string): string {
  const value = sender?.[key]
  return value === null || value === undefined ? '' : String(value)
}

function splitPdfLines(text: string): string[] {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function senderOrg(sender: any): string {
  return senderLine(sender, 'orgnr') || senderLine(sender, 'org_nr') || senderLine(sender, 'bedriftsnr') || senderLine(sender, 'mva_nr')
}

async function embedSenderLogo(pdf: PDFDocument, sender: any): Promise<any | null> {
  // Logo hentes fra Greknuts/Rett i Lomma sitt firmaoppsett.
  // Støtter logo_url direkte, eller logo_path fra bucket hovslager-logo.
  // Kun PNG/JPG kan bygges inn i pdf-lib. Andre formater hoppes trygt over.
  const candidates: string[] = []
  const logoPath = String(sender?.logo_path || '').trim()
  if (logoPath) {
    try {
      const signed = await sb.storage.from('hovslager-logo').createSignedUrl(logoPath, 60 * 10)
      if (!signed.error && signed.data?.signedUrl) candidates.push(signed.data.signedUrl)
    } catch (e) {
      console.warn('Kunne ikke lage signed logo-URL', e)
    }
  }
  for (const key of ['logo_url', 'logo', 'logoUrl']) {
    const v = String(sender?.[key] || '').trim()
    if (v) candidates.push(v)
  }

  for (const url of candidates) {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        console.warn('Logo kunne ikke hentes', res.status, url)
        continue
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      const type = (res.headers.get('content-type') || url).toLowerCase()
      if (type.includes('png') || /\.png(\?|$)/i.test(url)) return await pdf.embedPng(bytes)
      if (type.includes('jpg') || type.includes('jpeg') || /\.jpe?g(\?|$)/i.test(url)) return await pdf.embedJpg(bytes)
      console.warn('Logoformat støttes ikke av PDF-generatoren. Bruk PNG eller JPG.', type)
    } catch (e) {
      console.warn('Kunne ikke legge inn logo på faktura', e)
    }
  }
  return null
}

function senderVippsNumber(sender: any): string {
  return senderLine(sender, 'vippsnr') || senderLine(sender, 'vippsnummer')
}

function senderVippsMottaker(sender: any): string {
  return senderLine(sender, 'vipps_mottaker') || senderLine(sender, 'navn') || 'Rett i Lomma'
}

function senderHeaderTitle(sender: any): string {
  const explicitHeader = senderLine(sender, 'faktura_brevhode')
    || senderLine(sender, 'brevhode')
    || senderLine(sender, 'app_faktura_brevhode')
  const firstLine = splitPdfLines(explicitHeader)[0]
  return firstLine || senderLine(sender, 'navn') || 'Rett i Lomma'
}

function senderFooterText(sender: any): string {
  const explicit = senderLine(sender, 'faktura_brevhale')
    || senderLine(sender, 'brevhale')
    || senderLine(sender, 'bunntekst')
    || senderLine(sender, 'app_faktura_bunntekst')
  if (explicit) return explicit
  const parts = [
    senderLine(sender, 'navn'),
    senderOrg(sender) ? `Org.nr: ${senderOrg(sender)}` : '',
    senderLine(sender, 'adresse'),
    [senderLine(sender, 'postnr'), senderLine(sender, 'poststed')].filter(Boolean).join(' '),
    senderLine(sender, 'epost'),
    senderLine(sender, 'telefon'),
    senderLine(sender, 'kontonr') ? `Kontonr: ${senderLine(sender, 'kontonr')}` : '',
    senderLine(sender, 'nettside'),
  ].filter(Boolean)
  return parts.join(' · ')
}

function senderHeaderDetails(sender: any): string[] {
  const explicitHeader = senderLine(sender, 'faktura_brevhode')
    || senderLine(sender, 'brevhode')
    || senderLine(sender, 'app_faktura_brevhode')
  const explicitLines = splitPdfLines(explicitHeader)
  if (explicitLines.length > 1) {
    // Første linje brukes som firmanavn/tittel. Resten er brevhodetekst.
    return explicitLines.slice(1, 9)
  }
  const org = senderOrg(sender)
  return [
    org ? `Org.nr: ${org}` : '',
    senderLine(sender, 'adresse'),
    [senderLine(sender, 'postnr'), senderLine(sender, 'poststed')].filter(Boolean).join(' '),
    senderLine(sender, 'epost') ? `E-post: ${senderLine(sender, 'epost')}` : '',
    senderLine(sender, 'telefon') ? `Telefon: ${senderLine(sender, 'telefon')}` : '',
    senderLine(sender, 'kontonr') ? `Kontonr: ${senderLine(sender, 'kontonr')}` : '',
    senderLine(sender, 'nettside'),
  ].filter(Boolean)
}


function invoiceLines(f: any): string[] {
  const lines: string[] = []
  lines.push(`Faktura ${f.fakturanr}`)
  lines.push('Rettilomma - HovslagerSystem')
  lines.push('')
  lines.push(`Kunde: ${String(f.kunde_navn ?? '')}`)
  if (f.kunde_adresse) lines.push(`Adresse: ${String(f.kunde_adresse)}`)
  if (f.kunde_epost) lines.push(`E-post: ${String(f.kunde_epost)}`)
  lines.push('')
  lines.push(`Fakturadato: ${String(f.fakturadato ?? '')}`)
  lines.push(`Forfallsdato: ${String(f.forfallsdato ?? '')}`)
  lines.push(`Periode: ${String(f.fakturaperiode ?? '')}`)
  lines.push('')
  if (f.gratis_dager_igjen !== null && f.gratis_dager_igjen !== undefined) {
    lines.push(`Gratis prøveperiode: ${f.gratis_dager_igjen} gratis dager gjenstår av ${TRIAL_DAYS}.`)
    if (f.trial_end) lines.push(`Prøveperioden varer til ${String(f.trial_end)}.`)
    lines.push('')
  }
  lines.push(String(f.tekst ?? ''))
  lines.push('')
  lines.push(`Beløp eks. mva: ${kr(Number(f.belop_eks_mva ?? 0))} kr`)
  lines.push(`MVA (${kr(Number(f.mva_sats ?? 0))}%): ${kr(Number(f.mva_belop ?? 0))} kr`)
  lines.push(`Total inkl. mva: ${kr(Number(f.total_inkl_mva ?? 0))} kr`)
  lines.push('')
  lines.push(`Å betale: ${kr(Number(f.total_inkl_mva ?? 0))} kr`)
  lines.push('')
  lines.push('Fakturaen er automatisk generert av HovslagerSystem.')
  return lines
}

function wrapLine(text: string, maxChars = 86): string[] {
  const out: string[] = []
  const words = String(text ?? '').split(/\s+/)
  let line = ''
  for (const word of words) {
    if (!word) continue
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length > maxChars && line) {
      out.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) out.push(line)
  return out.length ? out : ['']
}

async function fakturaPdfBytes(f: any, sender: any | null = null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = sender ? await embedSenderLogo(pdf, sender) : null
  const margin = 48
  const pageW = 595.28
  const pageH = 841.89
  const footerY = 34
  let page = pdf.addPage([pageW, pageH])
  let y = 650

  function drawLetterhead(targetPage: any) {
    const headerTop = 790
    const logoBoxW = logo ? 118 : 0
    const textX = logo ? margin + logoBoxW + 28 : margin
    if (logo) {
      const dims = logo.scaleToFit(110, 82)
      targetPage.drawImage(logo, { x: margin, y: headerTop - dims.height + 4, width: dims.width, height: dims.height })
    }

    // Brevhode: høyrestilt topptekst til høyre for logo. Ingen linjer tegnes oppå hverandre.
    const headerRight = 545
    function drawRight(text: string, yPos: number, size: number, chosenFont: any, color: any) {
      const width = chosenFont.widthOfTextAtSize(String(text || ''), size)
      targetPage.drawText(String(text || ''), { x: headerRight - width, y: yPos, size, font: chosenFont, color })
    }
    drawRight(senderHeaderTitle(sender), headerTop, 17, bold, rgb(0.07, 0.09, 0.13))
    let sy = headerTop - 17
    for (const line of senderHeaderDetails(sender).slice(0, 7)) {
      for (const wrapped of wrapLine(line, 46)) {
        drawRight(wrapped, sy, 9, font, rgb(0.22, 0.25, 0.30))
        sy -= 11
      }
    }
    targetPage.drawLine({ start: { x: margin, y: 705 }, end: { x: 545, y: 705 }, thickness: 0.8, color: rgb(0.8, 0.82, 0.86) })
  }

  function drawFooter(targetPage: any) {
    targetPage.drawLine({ start: { x: margin, y: footerY + 22 }, end: { x: 545, y: footerY + 22 }, thickness: 0.6, color: rgb(0.8, 0.82, 0.86) })
    const footer = senderFooterText(sender)
    let fy = footerY + 7
    for (const line of wrapLine(footer, 118).slice(0, 3)) {
      targetPage.drawText(line, { x: margin, y: fy, size: 8, font, color: rgb(0.30, 0.33, 0.38) })
      fy -= 10
    }
  }

  function newContentPage() {
    drawFooter(page)
    page = pdf.addPage([pageW, pageH])
    drawLetterhead(page)
    y = 650
  }

  function newPageIfNeeded(height = 22) {
    if (y - height < 76) newContentPage()
  }
  function draw(text: string, opts: { size?: number; bold?: boolean; indent?: number } = {}) {
    const size = opts.size ?? 11
    const chosen = opts.bold ? bold : font
    for (const line of wrapLine(text, size >= 18 ? 42 : 82)) {
      newPageIfNeeded(size + 7)
      page.drawText(line, { x: margin + (opts.indent ?? 0), y, size, font: chosen, color: rgb(0.07, 0.09, 0.13) })
      y -= size + 6
    }
  }
  function gap(h = 10) { y -= h }
  function hr() {
    newPageIfNeeded(12)
    page.drawLine({ start: { x: margin, y }, end: { x: 545, y }, thickness: 0.8, color: rgb(0.8, 0.82, 0.86) })
    y -= 16
  }

  drawLetterhead(page)
  draw(`Faktura ${String(f.fakturanr ?? '')}`, { size: 24, bold: true })
  draw('HovslagerSystem abonnement', { size: 12 })
  hr()
  draw('Mottaker', { size: 13, bold: true })
  draw(String(f.kunde_navn ?? ''))
  if (f.kunde_adresse) draw(String(f.kunde_adresse ?? ''))
  if (f.kunde_epost) draw(String(f.kunde_epost ?? ''))
  gap(8)
  draw(`Fakturadato: ${String(f.fakturadato ?? '')}`)
  draw(`Forfallsdato: ${String(f.forfallsdato ?? '')}`)
  draw(`Periode: ${String(f.fakturaperiode ?? '')}`)
  gap(8)
  if (f.gratis_dager_igjen !== null && f.gratis_dager_igjen !== undefined) {
    draw('Gratis prøveperiode', { size: 13, bold: true })
    draw(`${f.gratis_dager_igjen} gratis dager gjenstår av ${TRIAL_DAYS}.`)
    if (f.trial_end) draw(`Prøveperioden varer til ${String(f.trial_end)}.`)
    gap(8)
  }
  hr()
  draw('Beskrivelse', { size: 13, bold: true })
  draw(String(f.tekst ?? ''))
  gap(10)
  draw(`Beløp eks. mva: ${kr(Number(f.belop_eks_mva ?? 0))} kr`)
  draw(`MVA (${kr(Number(f.mva_sats ?? 0))}%): ${kr(Number(f.mva_belop ?? 0))} kr`)
  draw(`Total inkl. mva: ${kr(Number(f.total_inkl_mva ?? 0))} kr`, { bold: true })
  gap(12)
  draw(`Å betale: ${kr(Number(f.total_inkl_mva ?? 0))} kr`, { size: 18, bold: true })
  gap(10)
  const vipps = senderVippsNumber(sender)
  if (vipps) {
    hr()
    const mottaker = senderVippsMottaker(sender)
    const vippsText = mottaker ? `Betal med Vipps: ${vipps} (${mottaker})` : `Betal med Vipps: ${vipps}`
    draw(vippsText, { size: 14, bold: true })
    gap(10)
  }
  gap(8)
  hr()
  draw('Fakturaen er automatisk generert av HovslagerSystem.', { size: 10 })

  drawFooter(page)
  return await pdf.save()
}

async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getUTCFullYear()
  const prefix = `RL-HOV-${year}-`
  const { count, error } = await sb
    .from('rettilomma_app_fakturaer')
    .select('id', { count: 'exact', head: true })
    .gte('fakturadato', `${year}-01-01`)
    .lte('fakturadato', `${year}-12-31`)
  if (error) throw error
  return prefix + String((count ?? 0) + 1).padStart(5, '0')
}

async function ensureTrialDates(firma: any, today: string) {
  const trialStart = firma.trial_start || today
  const trialEnd = firma.trial_end || addDays(trialStart, TRIAL_DAYS)
  const updates: any = {}
  if (!firma.trial_start) updates.trial_start = trialStart
  if (!firma.trial_end) updates.trial_end = trialEnd
  if (!firma.app_mnd_pris) updates.app_mnd_pris = DEFAULT_EKS_MVA
  if (!firma.abonnement_status) updates.abonnement_status = 'trial'
  if (Object.keys(updates).length) {
    await sb.from('hov_firma').update(updates).eq('id', firma.id)
  }
  return { trialStart, trialEnd }
}


function trialInfoForInvoice(firma: any, today: string) {
  const trialStart = String(firma.trial_start || today).slice(0, 10)
  const trialEnd = String(firma.trial_end || addDays(trialStart, TRIAL_DAYS)).slice(0, 10)
  const usedDays = Math.max(0, daysBetween(trialStart, today))
  const daysRemaining = Math.max(0, TRIAL_DAYS - usedDays)
  return { trialStart, trialEnd, usedDays, daysRemaining }
}

async function createInvoiceForFirma(firma: any, opts: any = {}) {
  if (isSysadmFirma(firma) && !opts.allow_sysadm_invoice) {
    return { created: false, reason: 'sysadm_sender_not_customer', faktura: null }
  }
  const today = opts.date ?? isoDate()
  await ensureBucket()
  const forfall = addDays(today, Number(opts.forfallsdager ?? 14))
  const periode = opts.fakturaperiode ?? monthKey(today)
  const belopEksMva = Number(opts.belop_eks_mva ?? firma.app_mnd_pris ?? DEFAULT_EKS_MVA)
  const mvaSats = Number(opts.mva_sats ?? DEFAULT_MVA)
  const mvaBelop = Math.round((belopEksMva * mvaSats / 100) * 100) / 100
  const total = Math.round((belopEksMva + mvaBelop) * 100) / 100
  const tekst = opts.tekst ?? `Abonnement HovslagerSystem ${periode}`

  // Ikke lag flere ubetalte abonnementsfakturaer for samme firma og periode.
  if (!opts.force) {
    const { data: existing, error: existingError } = await sb
      .from('rettilomma_app_fakturaer')
      .select('*')
      .eq('firma_id', firma.id)
      .eq('fakturatype', 'app_abonnement')
      .eq('fakturaperiode', periode)
      .in('status', ['opprettet', 'sendt', 'ubetalt'])
      .maybeSingle()
    if (existingError) throw existingError
    if (existing) return { created: false, reason: 'already_exists_for_period', faktura: existing }
  }

  const fakturanr = await nextInvoiceNumber()
  const payload: any = {
    firma_id: firma.id,
    fakturanr,
    fakturadato: today,
    forfallsdato: forfall,
    fakturaperiode: periode,
    kunde_navn: firma.navn ?? '',
    kunde_epost: firma.epost ?? '',
    kunde_adresse: firma.adresse ?? '',
    tekst,
    belop_eks_mva: belopEksMva,
    mva_sats: mvaSats,
    mva_belop: mvaBelop,
    total_inkl_mva: total,
    status: 'opprettet',
    storage_bucket: BUCKET,
    storage_folder: STORAGE_FOLDER_LABEL,
    gratis_dager_igjen: opts.gratis_dager_igjen ?? null,
    trial_start: opts.trial_start ?? null,
    trial_end: opts.trial_end ?? null,
  }

  const { data: inserted, error: insertError } = await sb
    .from('rettilomma_app_fakturaer')
    .insert(payload)
    .select('*')
    .single()
  if (insertError) throw insertError

  const sender = opts.sender ?? await getGreknutsSenderFirma()
  const pdfBytes = await fakturaPdfBytes(inserted, sender)
  const year = today.slice(0, 4)
  const month = today.slice(5, 7)
  const safeInvoice = String(fakturanr).replace(/[^A-Za-z0-9_-]+/g, '-')
  const storagePath = `${FOLDER}/${firma.id}/${year}/${month}/${safeInvoice}.pdf`
  const { error: uploadError } = await sb.storage.from(BUCKET).upload(storagePath, pdfBytes, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (uploadError) throw uploadError
  const { data: publicUrl } = sb.storage.from(BUCKET).getPublicUrl(storagePath)

  const { data: updated, error: updateError } = await sb
    .from('rettilomma_app_fakturaer')
    .update({ storage_path: storagePath, file_url: publicUrl.publicUrl, pdf_url: publicUrl.publicUrl })
    .eq('id', inserted.id)
    .select('*')
    .single()
  if (updateError) throw updateError

  if (!opts.do_not_update_status) {
    await sb.from('hov_firma').update({
      abonnement_status: 'aktiv',
      app_mnd_pris: Number(firma.app_mnd_pris ?? DEFAULT_EKS_MVA),
    }).eq('id', firma.id)
  }

  return { created: true, faktura: updated }
}

async function dailyCheckFirma(firma: any, today: string) {
  const { trialStart, trialEnd } = await ensureTrialDates(firma, today)
  const ageDays = daysBetween(trialStart, today)
  const stillTrial = ageDays < TRIAL_DAYS && today <= trialEnd

  if (stillTrial) {
    const info = trialInfoForInvoice({ ...firma, trial_start: trialStart, trial_end: trialEnd }, today)
    return await createInvoiceForFirma(firma, {
      date: today,
      belop_eks_mva: 0,
      mva_sats: DEFAULT_MVA,
      forfallsdager: 0,
      fakturaperiode: `trial-${today}`,
      tekst: `Gratis prøveperiode HovslagerSystem - 0 kr. Gratis dager igjen: ${info.daysRemaining} av ${TRIAL_DAYS}. Prøveperiode til ${info.trialEnd}.`,
      gratis_dager_igjen: info.daysRemaining,
      trial_start: info.trialStart,
      trial_end: info.trialEnd,
      do_not_update_status: true,
      sender: firma._sender ?? null,
    })
  }

  return await createInvoiceForFirma(firma, {
    date: today,
    belop_eks_mva: Number(firma.app_mnd_pris ?? DEFAULT_EKS_MVA),
    mva_sats: DEFAULT_MVA,
    tekst: `Abonnement HovslagerSystem ${monthKey(today)} - 400 kr + mva`,
    sender: firma._sender ?? null,
  })
}

Deno.serve(async (req) => {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Mangler SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY')
    const body = await req.json().catch(() => ({}))
    const action = body.action ?? 'daily' // daily er standard og kan kjøres av cron hver dag

    if (action === 'test_zero') {
      if (!body.firma_id && !body.epost) throw new Error('Mangler firma_id eller epost')
      let query = sb.from('hov_firma').select('*')
      if (body.firma_id) query = query.eq('id', body.firma_id)
      else query = query.ilike('epost', body.epost)
      const { data: firma, error } = await query.single()
      if (error) throw error
      const today = body.date ?? isoDate()
      const dates = await ensureTrialDates(firma, today)
      const info = trialInfoForInvoice({ ...firma, ...dates }, today)
      const result = await createInvoiceForFirma(firma, {
        date: today,
        belop_eks_mva: 0,
        mva_sats: DEFAULT_MVA,
        forfallsdager: 0,
        fakturaperiode: `test-0kr-${today}-${Date.now()}`,
        tekst: `Testfaktura prøveperiode - 0 kr. Gratis dager igjen: ${info.daysRemaining} av ${TRIAL_DAYS}. Prøveperiode til ${info.trialEnd}.`,
        gratis_dager_igjen: info.daysRemaining,
        trial_start: info.trialStart,
        trial_end: info.trialEnd,
        manual: true,
        force: true,
        do_not_update_status: true,
        sender: await getGreknutsSenderFirma(),
      })
      return Response.json({ ok: true, test_zero: true, gratis_dager_igjen: info.daysRemaining, trial_end: info.trialEnd, ...result })
    }

    if (action === 'manual') {
      if (!body.firma_id) throw new Error('Mangler firma_id')
      const { data: firma, error } = await sb.from('hov_firma').select('*').eq('id', body.firma_id).single()
      if (error) throw error
      const result = await createInvoiceForFirma(firma, { ...body, manual: true, force: true, sender: await getGreknutsSenderFirma() })
      return Response.json({ ok: true, ...result })
    }

    const { data: firmaer, error } = await sb
      .from('hov_firma')
      .select('*')
      .neq('abonnement_status', 'deaktivert')
    if (error) throw error

    const results = []
    const today = body.date ?? isoDate()
    const sender = await getGreknutsSenderFirma()
    for (const firma of firmaer ?? []) {
      if (isSysadmFirma(firma)) {
        results.push({ created: false, reason: 'sysadm_sender_not_customer', firma_id: firma.id, epost: firma.epost })
        continue
      }
      results.push(await dailyCheckFirma({ ...firma, _sender: sender }, today))
    }

    return Response.json({
      ok: true,
      checked_count: results.length,
      created_count: results.filter(r => r.created).length,
      skipped_count: results.filter(r => !r.created).length,
      results,
    })
  } catch (e) {
    console.error(e)
    return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 })
  }
})
