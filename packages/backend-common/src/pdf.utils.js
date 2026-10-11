'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateContractPDF = void 0;
const PDFDocument = require('pdfkit');
/**
 * Generates an Enterprise-grade Quotation PDF with professional branding
 */
exports.generateQuotationPDF = (doc, quote, company) => {
    // 1. Branding Setup
    const brandColor = company.themeColor || '#cf1d29'; // 180workspace Red fallback
    const secondaryColor = '#64748b';
    const borderColor = '#e2e8f0';
    const textColor = '#1e293b';
    doc.info['Title'] = `Quotation ${quote.quoteNumber}`;
    doc.info['Author'] = company.companyName || '180workspace System';
    // Helper: Add Logo or Styled Text
    const renderLogo = (x, y) => {
        if (company.logoUrl) {
            try {
                // If it's a URL, this might fail unless we download it first. 
                // In production, logos should be local or cached. 
                // For now, we fallback to styled text if anything fails.
                doc.image(company.logoUrl, x, y, { width: 120 });
                return y + 60;
            }
            catch (e) {
                doc.fillColor(brandColor).fontSize(24).font('Helvetica-Bold').text(company.companyName?.toUpperCase() || '180workspace SYSTEM', x, y);
                return y + 30;
            }
        }
        else {
            doc.fillColor(brandColor).fontSize(24).font('Helvetica-Bold').text(company.companyName?.toUpperCase() || '180workspace SYSTEM', x, y);
            return y + 30;
        }
    };
    // --- Header Section ---
    const headerBottom = renderLogo(50, 50);
    // Company Header Info
    doc.fillColor(secondaryColor).fontSize(9).font('Helvetica');
    doc.text(company.address || 'Business Headquarters', 50, headerBottom + 5);
    doc.text(`${company.adminEmail || 'contact@company.com'} | ${company.adminPhone || '+1 (000) 000-0000'}`, 50, headerBottom + 18);
    if (company.website)
        doc.text(company.website, 50, headerBottom + 31);
    // Header Right - Quotation Label
    doc.fillColor(brandColor).fontSize(28).font('Helvetica-Bold').text('QUOTATION', 350, 55, { align: 'right', width: 210 });
    // Meta Info Block
    const metaY = 100;
    const fields = [
        { label: 'Quote #:', value: quote.quoteNumber },
        { label: 'Date:', value: new Date(quote.createdAt).toLocaleDateString() },
        { label: 'Expires:', value: new Date(quote.validUntil).toLocaleDateString() },
        { label: 'Status:', value: quote.status.toUpperCase() }
    ];
    fields.forEach((field, i) => {
        const itemY = metaY + (i * 15);
        doc.fontSize(9).font('Helvetica-Bold').fillColor(textColor).text(field.label, 350, itemY, { width: 100, align: 'left' });
        doc.font('Helvetica').fillColor(secondaryColor).text(field.value, 460, itemY, { width: 100, align: 'right' });
    });
    // Divider Line
    doc.moveTo(50, 175).lineTo(560, 175).lineWidth(2).strokeColor(brandColor).stroke();
    // --- Billing Section ---
    const billingY = 200;
    doc.fillColor(brandColor).fontSize(10).font('Helvetica-Bold').text('BILL TO:', 50, billingY);
    const client = quote.clientId;
    doc.fillColor(textColor).fontSize(13).font('Helvetica-Bold').text(client?.name || 'Valued Customer', 50, billingY + 15);
    doc.font('Helvetica').fontSize(10).fillColor(secondaryColor);
    let currentCustomerY = billingY + 32;
    if (client?.company) {
        doc.text(client.company, 50, currentCustomerY);
        currentCustomerY += 14;
    }
    if (client?.email) {
        doc.text(client.email, 50, currentCustomerY);
        currentCustomerY += 14;
    }
    if (client?.phone) {
        doc.text(client.phone, 50, currentCustomerY);
        currentCustomerY += 14;
    }
    // --- Table Section ---
    const tableTop = 300;
    doc.rect(50, tableTop, 510, 25).fill(brandColor);
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
    doc.text('DESCRIPTION', 65, tableTop + 8, { width: 280 });
    doc.text('QTY', 350, tableTop + 8, { width: 40, align: 'center' });
    doc.text('UNIT PRICE', 400, tableTop + 8, { width: 75, align: 'right' });
    doc.text('TOTAL', 485, tableTop + 8, { width: 65, align: 'right' });
    let currentY = tableTop + 25;
    doc.font('Helvetica').fontSize(9).fillColor(textColor);
    quote.items.forEach((item, index) => {
        // Striped Background
        if (index % 2 === 0) {
            doc.rect(50, currentY, 510, 24).fill('#f9fafb');
        }
        doc.fillColor(textColor);
        doc.text(item.description, 65, currentY + 7, { width: 280 });
        doc.text(item.quantity.toString(), 350, currentY + 7, { width: 40, align: 'center' });
        doc.text(`$${Number(item.unitPrice).toLocaleString()}`, 400, currentY + 7, { width: 75, align: 'right' });
        doc.text(`$${(item.quantity * item.unitPrice).toLocaleString()}`, 485, currentY + 7, { width: 65, align: 'right' });
        currentY += 24;
        // Smart Page Break
        if (currentY > 700) {
            doc.addPage();
            currentY = 50;
            // Redraw Header for new page
            doc.rect(50, currentY, 510, 20).fill(brandColor);
            doc.fillColor('#ffffff').fontSize(8).text('DESCRIPTION', 65, currentY + 6);
            currentY += 20;
        }
    });
    // --- Totals Section ---
    let totalsY = currentY + 20;
    // Check if totals fit on current page
    if (totalsY > 650) {
        doc.addPage();
        totalsY = 50;
    }
    const subtotal = (quote.subtotal || 0);
    const tax = (quote.taxTotal || 0);
    const discount = (quote.discount || 0);
    const renderTotalRow = (label, val, isFinal = false) => {
        if (isFinal) {
            doc.rect(340, totalsY - 4, 220, 24).fill(brandColor);
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11);
        }
        else {
            doc.fillColor(secondaryColor).font('Helvetica').fontSize(9);
        }
        doc.text(label, 350, totalsY, { width: 100, align: 'left' });
        doc.text(val, 460, totalsY, { width: 90, align: 'right' });
        totalsY += isFinal ? 30 : 18;
    };
    renderTotalRow('Subtotal:', `$${subtotal.toLocaleString()}`);
    if (tax > 0)
        renderTotalRow('Tax:', `+$${tax.toLocaleString()}`);
    if (discount > 0)
        renderTotalRow('Discount:', `-$${discount.toLocaleString()}`);
    renderTotalRow('GRAND TOTAL:', `$${quote.grandTotal.toLocaleString()}`, true);
    // --- Signature Section ---
    let signatureY = Math.max(totalsY + 40, 680);
    if (signatureY > 750) {
        doc.addPage();
        signatureY = 100;
    }
    // Attempt to render Authorized Signature (Branding or Seal)
    const sigUrl = company.signatureUrl || company.logoUrl;
    if (sigUrl) {
        try {
            doc.image(sigUrl, 75, signatureY - 45, { width: 70, opacity: 0.8 });
        }
        catch (e) {
            // If image fails, just the line is fine
        }
    }
    doc.moveTo(50, signatureY).lineTo(220, signatureY).lineWidth(0.5).strokeColor(secondaryColor).stroke();
    doc.moveTo(390, signatureY).lineTo(560, signatureY).lineWidth(0.5).strokeColor(secondaryColor).stroke();
    doc.fontSize(8).fillColor(secondaryColor);
    doc.text('Authorized Signature', 50, signatureY + 5, { width: 170, align: 'center' });
    doc.text('Customer Acceptance', 390, signatureY + 5, { width: 170, align: 'center' });
    // --- Footer & Legal ---
    const footerY = 780;
    doc.moveTo(50, footerY).lineTo(560, footerY).lineWidth(0.5).strokeColor(borderColor).stroke();
    doc.fontSize(7).fillColor('#94a3b8').text('LEGAL NOTICE: This quotation is a formal offer subject to availability. By accepting, you agree to our standard terms of service.', 50, footerY + 8, { align: 'center', width: 512 });
    doc.text(`Generated by 180workspace System for ${company.companyName || 'Valued Partners'} - Page 1 of 1`, 50, footerY + 18, { align: 'center', width: 512 });
    return doc;
};
/**
 * Generates an Enterprise-grade Contract PDF with professional branding
 */
const generateContractPDF = (doc, contractData, company, client) => {
    // 1. Branding Setup
    const brandColor = company.themeColor || '#cf1d29'; // 180workspace Red fallback
    const secondaryColor = '#64748b';
    const borderColor = '#e2e8f0';
    const textColor = '#1e293b';
    doc.info['Title'] = contractData.contractTitle || 'Legal Agreement';
    doc.info['Author'] = company.companyName || '180workspace System';
    // Helper: Add Logo or Styled Text
    const renderLogo = (x, y) => {
        if (company.logoUrl) {
            try {
                doc.image(company.logoUrl, x, y, { width: 120 });
                return y + 60;
            }
            catch (e) {
                doc.fillColor(brandColor).fontSize(24).font('Helvetica-Bold').text(company.companyName?.toUpperCase() || '180workspace SYSTEM', x, y);
                return y + 30;
            }
        }
        else {
            doc.fillColor(brandColor).fontSize(24).font('Helvetica-Bold').text(company.companyName?.toUpperCase() || '180workspace SYSTEM', x, y);
            return y + 30;
        }
    };
    // --- Header Section ---
    const headerBottom = renderLogo(50, 50);
    // Company Header Info
    doc.fillColor(secondaryColor).fontSize(9).font('Helvetica');
    doc.text(company.address || 'Business Headquarters', 50, headerBottom + 5);
    doc.text(`${company.adminEmail || 'contact@company.com'} | ${company.adminPhone || '+1 (000) 000-0000'}`, 50, headerBottom + 18);
    if (company.website)
        doc.text(company.website, 50, headerBottom + 31);
    // Document Title
    doc.fillColor(brandColor).fontSize(22).font('Helvetica-Bold').text('LEGAL AGREEMENT', 300, 55, { align: 'right', width: 260 });
    // Divider Line
    doc.moveTo(50, headerBottom + 50).lineTo(560, headerBottom + 50).lineWidth(2).strokeColor(brandColor).stroke();
    // Contract Meta Info
    const metaY = headerBottom + 65;
    doc.fontSize(12).font('Helvetica-Bold').fillColor(textColor).text(contractData.contractTitle || 'Master Service Agreement', 50, metaY, { align: 'center', width: 512 });
    doc.fontSize(10).font('Helvetica').fillColor(secondaryColor).text(`Effective Date: ${new Date().toLocaleDateString()}`, 50, metaY + 20, { align: 'center', width: 512 });
    if (client) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor(textColor).text(`Prepared For: ${client.name || ''} ${client.company ? '(' + client.company + ')' : ''}`, 50, metaY + 45, { align: 'center', width: 512 });
    }
    // --- Body Text ---
    const startY = metaY + 80;
    doc.font('Helvetica').fontSize(10).fillColor(textColor);
    // contractData.contractText might have new lines
    const paragraphs = (contractData.contractText || '').split('\n');
    let currentY = startY;
    paragraphs.forEach(p => {
        if (!p.trim()) {
            currentY += 10;
            return;
        }
        // Auto wrap and paginate
        const height = doc.heightOfString(p, { width: 512, align: 'justify' });
        if (currentY + height > 700) {
            doc.addPage();
            currentY = 50;
        }
        // Bold headings if it looks like one (e.g. ALL CAPS or ends in a colon)
        if (p === p.toUpperCase() && p.trim().length > 3) {
            doc.font('Helvetica-Bold');
        }
        else if (p.trim().endsWith(':')) {
            doc.font('Helvetica-Bold');
        }
        else {
            doc.font('Helvetica');
        }
        doc.text(p, 50, currentY, { width: 512, align: 'justify', lineGap: 2 });
        currentY += height + 8;
    });
    // --- Signature Section ---
    let signatureY = Math.max(currentY + 40, 680);
    if (signatureY > 750) {
        doc.addPage();
        signatureY = 100;
    }
    const sigUrl = company.signatureUrl || company.logoUrl;
    if (sigUrl) {
        try {
            doc.image(sigUrl, 75, signatureY - 45, { width: 70, opacity: 0.8 });
        }
        catch (e) { }
    }
    doc.moveTo(50, signatureY).lineTo(220, signatureY).lineWidth(0.5).strokeColor(secondaryColor).stroke();
    doc.moveTo(390, signatureY).lineTo(560, signatureY).lineWidth(0.5).strokeColor(secondaryColor).stroke();
    doc.fontSize(8).fillColor(secondaryColor);
    doc.text(`${company.companyName || 'Company'} Representative`, 50, signatureY + 5, { width: 170, align: 'center' });
    doc.text(`${client?.name || 'Client'} Representative`, 390, signatureY + 5, { width: 170, align: 'center' });
    // --- Footer & Legal ---
    const footerY = 780;
    doc.moveTo(50, footerY).lineTo(560, footerY).lineWidth(0.5).strokeColor(borderColor).stroke();
    doc.fontSize(7).fillColor('#94a3b8').text('This document is electronically generated and represents a binding agreement upon signature.', 50, footerY + 8, { align: 'center', width: 512 });
    return doc;
};
exports.generateContractPDF = generateContractPDF;
