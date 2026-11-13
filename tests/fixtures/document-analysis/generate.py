"""Build small, authored Japanese PDF and DOCX files for extraction tests."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent


def write_pdf(name, objects):
    document = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = [0]
    for number, content in enumerate(objects, 1):
        offsets.append(len(document))
        document += f'{number} 0 obj\n'.encode() + content + b'\nendobj\n'
    xref = len(document)
    document += f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode()
    for offset in offsets[1:]:
        document += f'{offset:010d} 00000 n \n'.encode()
    document += f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    (root / name).write_bytes(document)


def stream(content, attributes=b''):
    return b'<< /Length ' + str(len(content)).encode() + b' ' + attributes + b' >>\nstream\n' + content + b'\nendstream'


def page_text(text):
    encoded = text.encode('utf-16be').hex().encode()
    return stream(b'BT /F1 14 Tf 40 700 Td <' + encoded + b'> Tj ET')


write_pdf('japanese.pdf', [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 8 0 R >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 9 0 R >>',
    b'<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UTF16-H /DescendantFonts [6 0 R] >>',
    b'<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /DW 1000 '
    b'/CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /FontDescriptor 7 0 R >>',
    b'<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [-92 -250 1010 922] '
    b'/ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 90 >>',
    page_text('返品の受付方法。商品と領収書をお持ちください。'),
    page_text('返金申請の期限は購入日から３０日以内です。'),
])

write_pdf('image-only.pdf', [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
    stream(b'\x40\x80\xc0', b'/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8'),
    stream(b'q 120 0 0 120 10 10 cm /Im1 Do Q'),
])

word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(root / 'japanese.docx', 'w', ZIP_DEFLATED) as archive:
    archive.writestr('[Content_Types].xml', '''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
    <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
    </Types>''')
    archive.writestr('_rels/.rels', '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>''')
    archive.writestr('word/_rels/document.xml.rels', '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
    </Relationships>''')
    archive.writestr('word/styles.xml', f'''<w:styles xmlns:w="{word}"><w:style w:type="paragraph" w:styleId="RefundHeading">
        <w:name w:val="払い戻し見出し"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>''')
    archive.writestr('word/document.xml', f'''<w:document xmlns:w="{word}"><w:body>
        <w:p><w:pPr><w:pStyle w:val="RefundHeading"/></w:pPr><w:r><w:t>返品と返金</w:t></w:r></w:p>
        <w:p><w:r><w:t>返品申請には領収書が必要です。</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>申請方法</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>オンライン窓口</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
        <w:p><w:r><w:t>窓口の営業時間は９時からです。</w:t></w:r></w:p>
        </w:body></w:document>''')
    archive.writestr('word/header1.xml', f'<w:hdr xmlns:w="{word}"><w:p><w:r><w:t>対象外ヘッダー</w:t></w:r></w:p></w:hdr>')

(root / 'shift-jis.txt').write_bytes('日本語の資料です。\r\n領収書をご用意ください。'.encode('cp932'))
