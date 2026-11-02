export function readFileSync(url, encoding) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', String(url), false);
  xhr.send(null);
  return xhr.responseText;
}

export default { readFileSync };

