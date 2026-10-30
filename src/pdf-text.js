// Group by actual text baselines, not rounded coordinate buckets: table cells
// (especially seats) can be a few pixels lower than the rest of the same row.
export function pdfItemsToText(items) {
  const lines = [];
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const y = item.transform[5],
      height = Math.abs(item.height) || 10;
    let line = lines
      .filter((l) => Math.abs(l.y - y) <= Math.min(l.height, height) * 0.4)
      .sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0];
    if (!line) {
      line = { y, height, items: [] };
      lines.push(line);
    }
    line.items.push({ x: item.transform[4], text: item.str });
  }
  return (
    lines
      .sort((a, b) => b.y - a.y)
      .map((l) =>
        l.items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.text)
          .join(' ')
      )
      .join('\n') + '\n'
  );
}
