export function splitFiles(html: string): {
  files: Record<string, string>;
  previewHtml: string;
} {
  const cssChunks: string[] = [];
  const jsChunks: string[] = [];

  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let cleanHtml = html.replace(styleRegex, (_match, content: string) => {
    const trimmed = content.trim();
    if (trimmed) cssChunks.push(trimmed);
    return "";
  });

  const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  cleanHtml = cleanHtml.replace(
    scriptRegex,
    (match, attrs: string, content: string) => {
      if (/\bsrc\s*=/i.test(attrs)) return match;
      if (/type\s*=\s*["']application\/ld\+json["']/i.test(attrs))
        return match;
      const trimmed = content.trim();
      if (trimmed) jsChunks.push(trimmed);
      return "";
    }
  );

  const css = cssChunks.join("\n\n");
  const js = jsChunks.join("\n\n");

  if (css) {
    if (/<\/head>/i.test(cleanHtml)) {
      cleanHtml = cleanHtml.replace(
        /<\/head>/i,
        '  <link rel="stylesheet" href="style.css">\n</head>'
      );
    } else {
      cleanHtml = `<link rel="stylesheet" href="style.css">\n` + cleanHtml;
    }
  }

  if (js) {
    if (/<\/body>/i.test(cleanHtml)) {
      cleanHtml = cleanHtml.replace(
        /<\/body>/i,
        '  <script src="main.js"></script>\n</body>'
      );
    } else {
      cleanHtml += `\n<script src="main.js"></script>`;
    }
  }

  const files: Record<string, string> = { "index.html": cleanHtml };
  if (css) files["style.css"] = css;
  if (js) files["main.js"] = js;

  return { files, previewHtml: html };
}

export function reassembleHTML(files: Record<string, string>): string {
  let html = files["index.html"] || "";

  if (files["style.css"]) {
    html = html.replace(
      /<link[^>]*href\s*=\s*["']style\.css["'][^>]*\/?>/i,
      `<style>\n${files["style.css"]}\n</style>`
    );
  }

  if (files["main.js"]) {
    html = html.replace(
      /<script[^>]*src\s*=\s*["']main\.js["'][^>]*>\s*<\/script>/i,
      `<script>\n${files["main.js"]}\n</script>`
    );
  }

  return html;
}
