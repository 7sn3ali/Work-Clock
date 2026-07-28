import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import puppeteer from "puppeteer";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Crucial: Increase JSON size limits to handle HTML & CSS payloads from the client
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API Route to generate PDF
  app.post("/api/generate-pdf", async (req, res) => {
    let browser;
    try {
      const { html, css, filename } = req.body;
      if (!html) {
        return res.status(400).json({ error: "HTML content is required" });
      }

      console.log("Generating server-side PDF...");

      // 1. Read the local Thmanyah font file and base64 encode it
      const fontPath = path.join(process.cwd(), "src/fonts/thmanyahseriftext-Regular.woff2");
      let fontBase64 = "";
      if (fs.existsSync(fontPath)) {
        try {
          const fontBuffer = fs.readFileSync(fontPath);
          fontBase64 = fontBuffer.toString("base64");
          console.log("Successfully base64 encoded local Thmanyah font");
        } catch (fontErr) {
          console.error("Error reading Thmanyah font file:", fontErr);
        }
      } else {
        console.warn("Thmanyah font file not found at path:", fontPath);
      }

      // 2. Build the embedded @font-face and theme overrides
      const fontFaceCss = `
        @font-face {
          font-family: 'Thmanyah';
          src: url('data:font/woff2;charset=utf-8;base64,${fontBase64}') format('woff2');
          font-weight: 100 900;
          font-style: normal;
          font-display: block;
        }
        
        /* Reset and enforce Light mode styles for printing */
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          box-sizing: border-box !important;
        }

        html, body {
          background-color: #ffffff !important;
          color: #1e293b !important;
          font-family: "Thmanyah", "Inter", system-ui, -apple-system, sans-serif !important;
          margin: 0 !important;
          padding: 0 !important;
          width: 210mm !important;
          min-height: 297mm !important;
          -webkit-font-smoothing: antialiased;
        }

        #invoice-print-element {
          background-color: #ffffff !important;
          color: #1e293b !important;
          width: 210mm !important;
          min-height: 297mm !important;
          box-shadow: none !important;
          border: none !important;
        }

        /* Ensure .font-thmanyah uses the embedded Thmanyah font family */
        .font-thmanyah {
          font-family: 'Thmanyah', serif !important;
          font-weight: normal !important;
        }
      `;

      // 3. Construct a fully self-contained HTML page
      const fullHtml = `
        <!DOCTYPE html>
        <html class="light">
          <head>
            <meta charset="utf-8">
            <title>Invoice PDF</title>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Dosis:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');
              ${css || ""}
              ${fontFaceCss}
            </style>
          </head>
          <body>
            ${html}
          </body>
        </html>
      `;

      // 4. Launch headless Puppeteer browser
      browser = await puppeteer.launch({
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-web-security",
          "--disable-features=IsolateOrigins,site-per-process",
        ],
        headless: true,
      });

      const page = await browser.newPage();
      
      // Set viewport to standard high resolution
      await page.setViewport({ width: 1200, height: 1600 });

      // Set the content
      await page.setContent(fullHtml, { waitUntil: "networkidle0" });

      // 5. CRITICAL: Wait for all fonts (Google Fonts and Base64 font) to fully load
      await page.evaluateHandle("document.fonts.ready");

      // 6. Print the page to A4 portrait PDF with background graphics enabled
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: {
          top: "0mm",
          bottom: "0mm",
          left: "0mm",
          right: "0mm",
        },
      });

      console.log(`Successfully generated server-side PDF. Size: ${pdfBuffer.length} bytes`);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename || "invoice.pdf"}"`
      );
      res.send(Buffer.from(pdfBuffer));
    } catch (err) {
      console.error("PDF generation endpoint failed:", err);
      res.status(500).json({ error: "Failed to generate PDF on server", details: String(err) });
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          console.error("Error closing browser:", closeErr);
        }
      }
    }
  });

  // Vite development middleware vs Static Production files
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development server middleware mounted");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving static production files from dist/");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
