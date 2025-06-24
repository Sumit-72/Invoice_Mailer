const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");
const easyinvoice = require("easyinvoice");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 8080;
app.use(cors());
app.use(express.json());

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

app.get("/hello", (req, res) => {
  res.send("HEllo world");
});

app.post("/test", (req, res) => {
  res.json({ ok: true, body: req.body });
});

app.post("/send-invoice", async (req, res) => {
  const { orderId, amount, email, products } = req.body;

  if (!orderId || !amount || !email || products.length === 0 || !products) {
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
        const colWidths = [140, 40, 60, 70, 80]; // Item, Qty, Rate, Discount, Amount

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

          const itemDescOptions = { width: 140 };
          const itemDescHeight = doc.heightOfString(
            item.description || "Item",
            itemDescOptions
          );
          const rowY = doc.y;

          doc.text(item.description || "Item", 50, rowY, { width: 140 });
          doc.text(`${qty}`, 250, rowY, { width: 40, align: "center" });
          doc.text(`₹${rate.toFixed(2)}`, 290, rowY, {
            width: 80,
            align: "right",
          });
          doc.text(`₹${discount.toFixed(2)}`, 370, rowY, {
            width: 70,
            align: "center",
          });
          doc.text(`₹${lineTotal.toFixed(2)}`, 440, rowY, {
            width: 80,
            align: "right",
          });

          doc.y = rowY + itemDescHeight + 2;
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

  let invoiceBuffer;
  try {
    invoiceBuffer = await generateInvoiceBuffer();
  } catch (err) {
    console.error("PDF generation error:", err);
    return res.status(500).json({ error: "Failed to generate invoice PDF." });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    secure: true,
    port: 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
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
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Email send error:", error);
      return res.status(500).json({ error: "Failed to send email." });
    } else {
      console.log("Email sent:", info.response);
      return res.status(200).json({ message: "Invoice sent successfully!" });
    }
  });
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
    return res
      .status(500)
      .json({ error: "Failed to generate/send EasyInvoice." });
  }
});

app.get("/", (req, res) => {
  res.send("Invoice Generator and Sender API is running");
});

app.listen(PORT, () =>
  console.log(`✅ Server running at: http://localhost:${PORT}`)
);
