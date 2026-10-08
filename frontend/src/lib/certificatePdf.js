// Doğrulama sertifikasını PDF olarak üretir (tarayıcıda; hiçbir şey sunucuya gitmez). jsPDF yalnızca bu dosya
// çağrıldığında yüklenir (dinamik import), ana pakete girmez.
import QRCode from 'qrcode';

export const LEGAL_NOTICE =
  'This certificate is a timestamped integrity proof anchored on the Solana blockchain. It shows that the listed wallet(s) '
  + 'recorded this exact file at the stated time and that it has not changed since. It is not a qualified electronic signature '
  + 'under eIDAS and does not by itself establish the identity of any signer or the legal validity of the document.';

const wrap = (doc, text, width) => doc.splitTextToSize(String(text), width);

/**
 * @param certificate buildCertificate() ya da buildAgreementCertificate() çıktısı
 * @returns {Promise<Blob>} PDF
 */
export async function buildCertificatePdf(certificate) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const left = 48;
  const width = 595 - left * 2;
  let y = 56;

  const heading = (text, size = 11) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(size); doc.setTextColor(17, 24, 39); doc.text(text, left, y); y += size + 6; };
  const field = (label, value) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 116, 139); doc.text(label.toUpperCase(), left, y); y += 11;
    doc.setFont('courier', 'normal'); doc.setFontSize(9); doc.setTextColor(17, 24, 39);
    const lines = wrap(doc, value ?? '-', width);
    doc.text(lines, left, y); y += lines.length * 12 + 8;
  };

  const isAgreement = certificate.version === 'notary.agreement.v1';
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(17, 24, 39);
  doc.text('Notary', left, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
  doc.text(isAgreement ? 'Agreement verification certificate' : 'Document verification certificate', left + 72, y);
  y += 24;
  doc.setDrawColor(229, 231, 235); doc.line(left, y, left + width, y); y += 20;

  if (isAgreement) {
    heading(certificate.complete ? 'Status: complete, every party has signed' : `Status: pending, ${certificate.signed_count} of ${certificate.parties.length} parties have signed`);
  } else {
    heading('Status: recorded on-chain');
  }
  y += 4;
  field('SHA-256 of the document', certificate.document_hash);
  field(isAgreement ? 'Agreement account (PDA)' : 'Proof account (PDA)', isAgreement ? certificate.agreement_pda : certificate.proof_pda);
  if (isAgreement) {
    field('Created by', certificate.creator);
    field('Created at (chain time, UTC)', certificate.created_at);
    heading('Parties', 10);
    for (const p of certificate.parties) {
      doc.setFont('courier', 'normal'); doc.setFontSize(8.5); doc.setTextColor(17, 24, 39);
      doc.text(p.signer, left, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      doc.setTextColor(p.signed_at ? 22 : 180, p.signed_at ? 101 : 83, p.signed_at ? 52 : 9);
      doc.text(p.signed_at ? `signed ${p.signed_at}` : 'not signed', left + 330, y);
      y += 14;
    }
    y += 6;
  } else {
    field('Signer (wallet)', certificate.signer);
    if (certificate.receiver) field('Receiver', certificate.receiver);
    field('Recorded at (chain time, UTC)', certificate.created_at);
  }
  if (certificate.tx_signature) field('Transaction signature', certificate.tx_signature);
  field('Network / program', `${certificate.cluster} / ${certificate.program_id}`);

  // Doğrulama bağlantısı ve QR
  field('Verify link', certificate.verify_url);
  const qr = await QRCode.toDataURL(certificate.verify_url, { margin: 1, width: 220 });
  doc.addImage(qr, 'PNG', left + width - 110, y - 4, 110, 110);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
  doc.text('Scan to verify the file against the chain.', left, y + 6);
  doc.text('No account or server of ours is needed.', left, y + 18);
  y += 124;

  doc.setDrawColor(229, 231, 235); doc.line(left, y, left + width, y); y += 16;
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
  doc.text(wrap(doc, LEGAL_NOTICE, width), left, y);

  return doc.output('blob');
}

export async function downloadCertificatePdf(certificate, fileName) {
  const blob = await buildCertificatePdf(certificate);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
