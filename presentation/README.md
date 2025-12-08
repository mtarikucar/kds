# HummyTummy Presentation Documents

This directory contains comprehensive presentation documents for the HummyTummy Restaurant Management Platform.

## 📄 Available Documents

### Turkish Version
- **File**: `HummyTummy_Presentation_TR.md`
- **Language**: Turkish
- **Target Audience**: Turkish-speaking restaurant owners and managers
- **Content**: Complete product presentation with competitive advantages, business value, and detailed features

### English Version
- **File**: `HummyTummy_Presentation_EN.md`
- **Language**: English
- **Target Audience**: International restaurant owners and managers
- **Content**: Complete product presentation with competitive advantages, business value, and detailed features

## 📊 Document Structure

Both documents include:

1. **Executive Summary** - Overview and value proposition
2. **Industry Problems & Solutions** - 6 major pain points and HummyTummy solutions with ROI examples
3. **Product Features** - 10 detailed feature categories
4. **Competitive Advantages** - 10 key differentiators from competitors
5. **Subscription Plans** - Detailed comparison table with pricing
6. **ROI Examples** - 3 realistic scenarios with financial projections
7. **Success Stories** - Real-world use cases and testimonials
8. **Technical Infrastructure** - Security, performance, and scalability
9. **FAQ** - Comprehensive frequently asked questions
10. **Next Steps** - Clear call-to-action and contact information

## 🎯 Focus Areas

The presentations emphasize:
- ✅ **Competitive Advantages** - How HummyTummy differs from competitors (Toast, Square, Lightspeed, TouchBistro)
- ✅ **Business Value/ROI** - Concrete financial benefits and return on investment
- ✅ **Product Features** - Comprehensive feature descriptions with use cases

## 📑 Converting to PDF

### Method 1: Using Pandoc (Recommended)

Pandoc is a powerful document converter that creates professional PDFs from Markdown.

#### Installation

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install pandoc texlive-xetex texlive-fonts-recommended texlive-fonts-extra
```

**macOS:**
```bash
brew install pandoc
brew install --cask mactex
```

**Windows:**
- Download from: https://pandoc.org/installing.html
- Install MiKTeX: https://miktex.org/download

#### Conversion Commands

**Turkish Version:**
```bash
cd /root/kds/presentation
pandoc HummyTummy_Presentation_TR.md \
  -o HummyTummy_Presentation_TR.pdf \
  --pdf-engine=xelatex \
  -V geometry:margin=1in \
  -V fontsize=11pt \
  -V documentclass=article \
  -V lang=tr \
  --toc \
  --toc-depth=2 \
  --highlight-style=tango
```

**English Version:**
```bash
cd /root/kds/presentation
pandoc HummyTummy_Presentation_EN.md \
  -o HummyTummy_Presentation_EN.pdf \
  --pdf-engine=xelatex \
  -V geometry:margin=1in \
  -V fontsize=11pt \
  -V documentclass=article \
  -V lang=en \
  --toc \
  --toc-depth=2 \
  --highlight-style=tango
```

#### Advanced Options

For better formatting with custom styling:
```bash
pandoc HummyTummy_Presentation_TR.md \
  -o HummyTummy_Presentation_TR.pdf \
  --pdf-engine=xelatex \
  -V geometry:margin=1in \
  -V fontsize=11pt \
  -V documentclass=article \
  -V lang=tr \
  -V mainfont="Liberation Sans" \
  -V monofont="Liberation Mono" \
  --toc \
  --toc-depth=2 \
  --number-sections \
  --highlight-style=tango \
  --metadata title="HummyTummy - Modern Restoran Yönetim Platformu" \
  --metadata author="HummyTummy Teknoloji A.Ş." \
  --metadata date="2025"
```

### Method 2: Using Markdown to PDF Tools

#### grip (GitHub Markdown Preview)
```bash
# Install
pip install grip

# Generate HTML (then print to PDF from browser)
grip HummyTummy_Presentation_TR.md --export HummyTummy_Presentation_TR.html
# Open in browser and use "Print to PDF"
```

#### md-to-pdf (Node.js)
```bash
# Install
npm install -g md-to-pdf

# Convert
md-to-pdf HummyTummy_Presentation_TR.md
md-to-pdf HummyTummy_Presentation_EN.md
```

#### marked-pdf (Node.js)
```bash
# Install
npm install -g marked-pdf

# Convert
marked-pdf HummyTummy_Presentation_TR.md -o HummyTummy_Presentation_TR.pdf
marked-pdf HummyTummy_Presentation_EN.md -o HummyTummy_Presentation_EN.pdf
```

### Method 3: Using Online Converters

If you prefer not to install software:

1. **Dillinger** (https://dillinger.io/)
   - Upload Markdown file
   - Click "Export as" → "PDF"

2. **Markdown to PDF** (https://www.markdowntopdf.com/)
   - Upload file or paste content
   - Download PDF

3. **CloudConvert** (https://cloudconvert.com/md-to-pdf)
   - Upload Markdown file
   - Convert to PDF

### Method 4: Using VS Code

If you use Visual Studio Code:

1. Install extension: "Markdown PDF" by yzane
2. Open the Markdown file
3. Right-click → "Markdown PDF: Export (pdf)"

### Method 5: Using GitHub/GitLab

1. Push the Markdown files to a GitHub/GitLab repository
2. Use repository features to render Markdown
3. Print the rendered page to PDF from your browser

## 🎨 Customization Tips

### Adding Images

To add images (logos, screenshots):
```markdown
![HummyTummy Logo](./images/logo.png)
```

Then create an `images` directory and add your files.

### Custom Styling

Create a custom CSS file for better PDF styling:

**custom.css:**
```css
body {
  font-family: 'Arial', sans-serif;
  line-height: 1.6;
  color: #333;
}

h1 {
  color: #2c3e50;
  border-bottom: 3px solid #3498db;
  padding-bottom: 10px;
}

h2 {
  color: #34495e;
  border-bottom: 2px solid #95a5a6;
  padding-bottom: 5px;
}

table {
  border-collapse: collapse;
  width: 100%;
}

th {
  background-color: #3498db;
  color: white;
  padding: 10px;
}

td {
  padding: 8px;
  border: 1px solid #ddd;
}

blockquote {
  border-left: 4px solid #3498db;
  padding-left: 15px;
  font-style: italic;
  color: #555;
}
```

Use with pandoc:
```bash
pandoc HummyTummy_Presentation_TR.md \
  -o HummyTummy_Presentation_TR.pdf \
  --pdf-engine=xelatex \
  --css=custom.css \
  -V geometry:margin=1in
```

## 📋 Print-Friendly Options

For presentations meant to be printed:

```bash
pandoc HummyTummy_Presentation_TR.md \
  -o HummyTummy_Presentation_TR_Print.pdf \
  --pdf-engine=xelatex \
  -V geometry:margin=0.75in \
  -V fontsize=10pt \
  -V documentclass=article \
  -V papersize=a4 \
  --toc \
  --number-sections
```

## 🔧 Troubleshooting

### LaTeX Error
If you get LaTeX errors with pandoc:
```bash
# Try using wkhtmltopdf instead
sudo apt install wkhtmltopdf
pandoc HummyTummy_Presentation_TR.md -o HummyTummy_Presentation_TR.pdf --pdf-engine=wkhtmltopdf
```

### Font Issues
If fonts are not rendering correctly:
```bash
# List available fonts
fc-list : family

# Use a different font
pandoc HummyTummy_Presentation_TR.md \
  -o HummyTummy_Presentation_TR.pdf \
  --pdf-engine=xelatex \
  -V mainfont="DejaVu Sans"
```

### Table Formatting
If tables are too wide:
- Use smaller font sizes with `-V fontsize=9pt`
- Adjust margins with `-V geometry:margin=0.5in`
- Consider landscape orientation with `-V geometry:landscape`

## 📧 Contact

For questions about these presentation documents:
- **Email**: info@hummytummy.com
- **Support**: support@hummytummy.com

## 📄 License

© 2025 HummyTummy Technology Inc. All rights reserved.

These presentation documents are proprietary and confidential. Distribution or reproduction without explicit permission is prohibited.

---

**Version**: 1.0
**Last Updated**: 2025
**Maintained by**: HummyTummy Marketing Team
