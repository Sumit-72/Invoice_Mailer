// IMPORTS
const express = require("express");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const cors = require("cors");
const easyinvoice = require("easyinvoice");

// CONFIG
dotenv.config();
const app = express();
const PORT = process.env.PORT || 8080;
app.use(cors());
app.use(express.json());

// BASE64 ENCODER FOR IMAGE
function base64_encode(imgPath) {
    const image = fs.readFileSync(imgPath);
    return Buffer.from(image).toString("base64");
}

// PDFKIT ROUTE (Simple Invoice)
// app.post("/send-invoice", async (req, res) => {
//     const { orderId, amount, email } = req.body;
//     if (!orderId || !amount || !email) {
//         return res.status(400).json({ error: "Missing required fields" });
//     }

//     const invoiceFilename = `invoice-${orderId}.pdf`;
//     const invoicePath = path.join(__dirname, invoiceFilename);

//     try {
//         await new Promise((resolve, reject) => {
//             const doc = new PDFDocument();
//             const stream = fs.createWriteStream(invoicePath);
//             doc.pipe(stream);

//             doc.fontSize(20).text("Invoice", { align: "center" });
//             doc.moveDown();
//             doc.fontSize(14).text(`Order ID: ${orderId}`);
//             doc.text(`Amount: ₹${amount}`);
//             doc.text(`Date: ${new Date().toLocaleString()}`);
//             doc.end();

//             stream.on("finish", resolve);
//             stream.on("error", reject);
//         });
//     } catch (err) {
//         return res.status(500).json({ error: "Failed to generate invoice PDF." });
//     }

//     const transporter = nodemailer.createTransport({
//         service: "gmail",
//         secure: true,
//         port: 465,
//         auth: {
//             user: process.env.EMAIL_USER,
//             pass: process.env.EMAIL_PASS
//         },
//     });

//     const mailOptions = {
//         from: process.env.EMAIL_USER,
//         to: email,
//         subject: "Payment Confirmation - Order",
//         text: `Thanks for your payment of ₹${amount}. Please find your invoice attached.`,
//         attachments: [{ filename: invoiceFilename, path: invoicePath }],
//     };

//     transporter.sendMail(mailOptions, (error, info) => {
//         fs.unlinkSync(invoicePath); // Cleanup

//         if (error) {
//             console.error(error);
//             return res.status(500).json({ error: "Failed to send email." });
//         } else {
//             console.log("Email sent:", info.response);
//             return res.status(200).json({ message: "Invoice sent successfully!" });
//         }
//     });
// });

app.post("/send-invoice", async (req, res) => {
    const { orderId, amount, email } = req.body;

    if (!orderId || !amount || !email) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // Function to generate invoice PDF as a buffer (in-memory)
    const generateInvoiceBuffer = () => {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument();
                const buffers = [];

                doc.on("data", buffers.push.bind(buffers));
                doc.on("end", () => {
                    const pdfData = Buffer.concat(buffers);
                    resolve(pdfData);
                });

                doc.fontSize(20).text("Invoice", { align: "center" });
                doc.moveDown();
                doc.fontSize(14).text(`Order ID: ${orderId}`);
                doc.text(`Amount: ₹${amount}`);
                doc.text(`Date: ${new Date().toLocaleString()}`);
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

    // Setup mail transporter
    const transporter = nodemailer.createTransport({
        service: "gmail",
        secure: true,
        port: 465,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        },
    });

    // Email options with in-memory PDF attachment
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Payment Confirmation - Order",
        text: `Thanks for your payment of ₹${amount}. Please find your invoice attached.`,
        attachments: [
            {
                filename: `invoice-${orderId}.pdf`,
                content: invoiceBuffer,
                contentType: "application/pdf"
            }
        ]
    };

    // Send email
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

// EASYINVOICE ROUTE (Styled Invoice with Logo)
app.post("/generate-invoice", async (req, res) => {
    const { email, invoiceNumber, invoiceDate, products, client } = req.body;

    if (!email || !invoiceNumber || !invoiceDate || !products || !client) {
        return res.status(400).json({ error: "Missing required invoice fields" });
    }

    const logoPath = path.resolve("img", "invoice.png");
    const base64Logo = fs.readFileSync(logoPath, { encoding: 'base64' });

    const data = {
        currency: "INR",
        taxNotation: "gst",
        marginTop: 25,
        marginRight: 25,
        marginLeft: 25,
        marginBottom: 25,
        logo: base64Logo,
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

    try {
        const result = await easyinvoice.createInvoice(data);

        // Create email with PDF attached directly from base64
        const transporter = nodemailer.createTransport({
            service: "gmail",
            secure: true,
            port: 465,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            },
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Your EasyInvoice is Ready",
            text: `Please find your invoice (${invoiceNumber}) attached.`,
            attachments: [
                {
                    filename: `invoice-${invoiceNumber}.pdf`,
                    content: result.pdf,
                    encoding: 'base64'
                }
            ],
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error(error);
                return res.status(500).json({ error: "Failed to send invoice." });
            } else {
                console.log("Email sent:", info.response);
                return res.status(200).json({ message: "EasyInvoice sent successfully!" });
            }
        });
    } catch (err) {
        console.error("Invoice error:", err);
        return res.status(500).json({ error: "Error generating EasyInvoice." });
    }
});

app.get('/', (req, res) => {
    res.send('Invoice Generator and Sender API is running');
});

// LISTEN
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
