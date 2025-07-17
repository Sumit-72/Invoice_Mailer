// Required Modules
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");
const easyinvoice = require("easyinvoice");
const https = require("https");

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middlewares
app.use(cors());
app.use(express.json());

// Email Transporter Setup
const getTransporter = () =>
  nodemailer.createTransport({
    service: "gmail",
    secure: true,
    port: 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

// Simple PDF Generator
const generateSimpleInvoice = ({ orderId, amount }) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const buffers = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      doc.fontSize(20).text("Invoice", { align: "center" }).moveDown();
      doc.fontSize(14).text(`Order ID: ${orderId}`);
      doc.text(`Amount: ₹${amount}`);
      doc.text(`Date: ${new Date().toLocaleString()}`);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });

// Routes
app.get("/hello", (req, res) => {
  res.send("Hello world");
});

app.post("/test", (req, res) => {
  res.json({ ok: true, body: req.body });
});

// Route 1: PDFKit Invoice
app.post("/send-invoice", async (req, res) => {
  const { orderId, amount, email, products } = req.body;

  if (!orderId || !amount || !email || !products?.length) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const generateInvoiceBuffer = () => {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];

        doc.on("data", buffers.push.bind(buffers));
        doc.on("end", () => {
          const pdfData = Buffer.concat(buffers);
          resolve(pdfData);
        });

        doc.fontSize(20).text("INVOICE", { align: "center" }).moveDown();
        doc.fontSize(12).text("DeQueue Technologies Pvt Ltd");
        doc.text("India\nGSTIN: 27AAACI1234A1Z5").moveDown();

        doc.font("Helvetica-Bold").text("Bill To:");
        doc.font("Helvetica").text(email).moveDown();

        doc.text(`Invoice Number: ${orderId}`);
        doc.text(`Invoice Date: ${new Date().toLocaleDateString()}`).moveDown();

        const colX = 50;
        const colWidths = [140, 40, 60, 70, 80];

        const startY = doc.y;
        doc.font("Helvetica-Bold");
        doc.text("Item", 50, startY, { width: 140 });
        doc.text("Qty", 250, startY, { width: 40, align: "center" });
        doc.text("Rate", 290, startY, { width: 80, align: "right" });
        doc.text("Discount", 370, startY, { width: 70, align: "right" });
        doc.text("Amount", 440, startY, { width: 80, align: "right" });
        doc.moveDown();
        doc.font("Helvetica");

        let subtotal = 0;
        for (const item of products) {
          const qty = item.quantity || 1;
          const rate = item.price || 0;
          const discount = 0.05 * rate;
          const discountedRate = rate - discount;
          const lineTotal = qty * discountedRate;
          subtotal += lineTotal;

          const rowY = doc.y;
          doc.text(item.description || "Item", 50, rowY, { width: 140 });
          doc.text(`${qty}`, 250, rowY, { width: 40, align: "center" });
          doc.text(`₹${rate.toFixed(2)}`, 290, rowY, { width: 80, align: "right" });
          doc.text(`₹${discount.toFixed(2)}`, 370, rowY, { width: 70, align: "center" });
          doc.text(`₹${lineTotal.toFixed(2)}`, 440, rowY, { width: 80, align: "right" });

          doc.y = rowY + doc.heightOfString(item.description || "Item", { width: 140 }) + 2;
        }

        const tax = subtotal * 0.05;
        const total = subtotal + tax;

        doc.moveDown();
        doc.font("Helvetica-Bold");
        doc.text(`Subtotal: ₹${subtotal.toFixed(2)}`, { align: "right" });
        doc.text(`GST (5%): ₹${tax.toFixed(2)}`, { align: "right" });
        doc.text(`Total: ₹${total.toFixed(2)}`, { align: "right" });

        doc.moveDown(3);
        doc.font("Helvetica").fontSize(10);
        doc.text("Thank you for your business!", 0, doc.y, {
          align: "center",
          width: doc.page.width,
        });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  };

  try {
    const invoiceBuffer = await generateInvoiceBuffer();
    const transporter = getTransporter();

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Payment Confirmation - Order",
      text: `Thanks for your payment of ₹${amount}. Please find your detailed invoice attached.`,
      attachments: [
        {
          filename: `invoice-${orderId}.pdf`,
          content: invoiceBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    return res.status(200).json({ message: "Invoice sent successfully!" });
  } catch (err) {
    console.error("PDF/email error:", err);
    return res.status(500).json({ error: "Failed to send invoice." });
  }
});

// Route 2: EasyInvoice
app.post("/generate-invoice", async (req, res) => {
  const { email, invoiceNumber, invoiceDate, products, client } = req.body;

  if (!email || !invoiceNumber || !invoiceDate || !products || !client) {
    return res.status(400).json({ error: "Missing required invoice fields" });
  }

  try {
    const logoPath = path.resolve("img", "invoice.png");
    const logoBase64 = fs.readFileSync(logoPath, { encoding: "base64" });

    const invoiceData = {
      currency: "INR",
      taxNotation: "gst",
      marginTop: 25,
      marginRight: 25,
      marginLeft: 25,
      marginBottom: 25,
      logo: logoBase64,
      sender: {
        company: "Buy Me A Gradient",
        address: "Corso Italia 13",
        zip: "1234 AB",
        city: "Milan",
        country: "IT",
      },
      client,
      invoiceNumber,
      invoiceDate,
      products,
      bottomNotice: "Kindly pay your invoice within 15 days.",
    };

    const result = await easyinvoice.createInvoice(invoiceData);
    const transporter = getTransporter();

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your EasyInvoice is Ready",
      text: `Please find your invoice (${invoiceNumber}) attached.`,
      attachments: [
        {
          filename: `invoice-${invoiceNumber}.pdf`,
          content: result.pdf,
          encoding: "base64",
        },
      ],
    });

    return res.status(200).json({ message: "EasyInvoice sent successfully!" });
  } catch (err) {
    console.error("EasyInvoice Error:", err);
    return res.status(500).json({ error: "Failed to generate/send EasyInvoice." });
  }
});

// Route 3: Invoice-Generator.com
function generateInvoice(invoice, filename, success, error) {
  const postData = JSON.stringify(invoice);
  const options = {
    hostname: "invoice-generator.com",
    port: 443,
    path: "/",
    method: "POST",
    headers: {
      "Authorization": "Bearer api key",
      "Content-Type": "application/pdf",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  const file = fs.createWriteStream(filename);

  const req = https.request(options, (res) => {
    res.on("data", (chunk) => file.write(chunk));
    res.on("end", () => {
      file.end();
      if (typeof success === "function") success();
    });
  });

  req.on("error", (err) => {
    if (typeof error === "function") error(err);
  });

  req.write(postData);
  req.end();
}

app.post("/invoice-generator", async (req, res) => {
  const { orderId, amount, email, products } = req.body;

  if (!orderId || !amount || !email || !products?.length) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const items = products.map((item) => ({
    name: item.description || "Item",
    quantity: item.quantity || 1,
    unit_cost: item.price || 0,
    // discount: 5,
  }));

  const invoice = {
    from: "DeQueue Technologies Pvt Ltd\nIndia\nGSTIN: 27AAACI1234A1Z5",
    to: email,
    currency: "INR",
    number: orderId,
    payment_terms: "Auto-Billed - Do Not Pay",
    items,
    fields: {
      discounts: true,
      tax: "%",
    },
    tax: 5,
    notes: "Thank you for your business!",
    terms: "No need to submit payment. You will be auto-billed for this invoice.",
  };

  const filename = `invoice-${orderId}.pdf`;
  generateInvoice(
    invoice,
    filename,
    async () => {
      try {
        const pdfBuffer = fs.readFileSync(filename);
        const transporter = getTransporter();

        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: email,
          subject: "Payment Confirmation - Order",
          text: `Thanks for your payment of ₹${amount}. Please find your detailed invoice attached.`,
          attachments: [
            {
              filename,
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ],
        });

        fs.unlinkSync(filename);
        return res.status(200).json({ message: "Invoice sent successfully!" });
      } catch (err) {
        console.error("Email send error:", err);
        return res.status(500).json({ error: "Failed to send invoice email." });
      }
    },
    (error) => {
      console.error("Invoice generation error:", error);
      return res.status(500).json({ error: "Failed to generate invoice PDF." });
    }
  );
});

app.get("/", (req, res) => {
  res.send("Invoice Generator and Sender API is running");
});

// Start Server
app.listen(PORT, () =>
  console.log(`\u2705 Server running at: http://localhost:${PORT}`)
);
