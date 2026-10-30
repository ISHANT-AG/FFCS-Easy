export async function validatePdfUpload(file) {
  if (!file || !/\.pdf$/i.test(file.name)) throw Error('Please upload a PDF file.');
  const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
  if (!header.includes('%PDF-'))
    throw Error('This is not a valid PDF. Export the file as PDF from FFCS.');
}
