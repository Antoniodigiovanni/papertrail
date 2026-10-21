import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metadataValue, validatePdf, xmpMetadata } from '../server/pdf.js';
import { textPdf, metadataPdf } from './fixture.js';

test('metadata fields cannot cross lines or accept labels and tool markers', () => {
    for (const value of ['', 'Subject:', 'Creator: LaTeX with hyperref', 'LaTeX with hyperref', 'untitled', 'pdfTeX']) {
        assert.equal(metadataValue(`Title: ${value}\nSubject:\nAuthor:\nCreator: LaTeX with hyperref`, 'Title'), undefined);
    }
    assert.equal(metadataValue('Author:\nCreator: LaTeX with hyperref', 'Author'), undefined);
    assert.equal(metadataValue('Title:\t Meaningful title\r\nAuthor: Ada', 'Title'), 'Meaningful title');
    assert.equal(metadataValue('garbage', 'Title'), undefined);
});
test('real PDF metadata retains meaningful fields and empty title stays absent', async () => {
    const normal = await validatePdf(textPdf());
    assert.ok(normal.title);
    assert.deepEqual(normal.authors, ['Ada Lovelace', 'Alan Turing']);
    assert.equal((await validatePdf(textPdf(''))).title, undefined);
    await assert.rejects(validatePdf(Buffer.from('%PDF-malformed %%EOF')));
});

test('XMP uses namespace-aware bibliographic lists and ignores malformed packets', () => {
    const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:RDF><rdf:Description><dc:title><rdf:Alt><rdf:li xml:lang="x-default">A meaningful &amp; exact title</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>Ada</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`;
    assert.deepEqual(xmpMetadata(xml), { title: 'A meaningful & exact title', authors: ['Ada'] });
    const cdata = `<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:RDF><rdf:Description><dc:title><rdf:Alt><rdf:li xml:lang="x-default"><![CDATA[Research & Methods]]></rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>Ada <![CDATA[Lovelace]]></rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`;
    assert.deepEqual(xmpMetadata(cdata), { title: 'Research & Methods', authors: ['Ada Lovelace'] });
    assert.deepEqual(xmpMetadata(xml.slice(0, -5)), {});
    assert.deepEqual(xmpMetadata('<!DOCTYPE x><x/>'), {});
    assert.deepEqual(xmpMetadata(''), {});
    assert.deepEqual(xmpMetadata(xml.replace('<rdf:Alt>', '<rdf:Seq>').replace('</rdf:Alt>', '</rdf:Seq>')), { title: undefined, authors: ['Ada'] });
    assert.deepEqual(xmpMetadata(xml.replace('A meaningful &amp; exact title', '<dc:creator>Wrong field</dc:creator>')), { title: undefined, authors: ['Ada'] });
});

test('actual Poppler empty fields do not consume Subject or Creator; meaningful XMP wins', async () => {
    const empty = await validatePdf(metadataPdf('<< /Title () /Subject () /Author () /Creator (LaTeX with hyperref) >>'));
    assert.equal(empty.title, undefined);
    assert.equal(empty.authors, undefined);
    const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:RDF><rdf:Description><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Meaningful XMP title</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>`;
    assert.equal((await validatePdf(metadataPdf('<< /Title (LaTeX with hyperref) >>', xml))).title, 'Meaningful XMP title');
    assert.equal((await validatePdf(metadataPdf('<< /Title (Useful info title) >>', '<broken'))).title, 'Useful info title');
    assert.equal((await validatePdf(metadataPdf('<< >>'))).title, undefined);
});

test('duplicate Info keys follow Poppler output without crossing empty fields', async () => {
    assert.equal(metadataValue('Title:\nTitle: Later title\nAuthor: Ada', 'Title'), undefined);
    assert.equal(metadataValue('Title: First title\nTitle: Later title', 'Title'), 'First title');
    const parsed = await validatePdf(metadataPdf('<< /Title (Earlier) /Title (Final title) /Subject (Unrelated subject) /Author (Ada; ; Alan;) /Creator (LaTeX with hyperref) /Producer (pdfTeX) >>'));
    assert.equal(parsed.title, 'Final title', 'Poppler resolves duplicate dictionary keys');
    assert.deepEqual(parsed.authors, ['Ada', 'Alan']);
    const labels = await validatePdf(metadataPdf('<< /Title (Subject:) /Author (Creator: LaTeX with hyperref) >>'));
    assert.equal(labels.title, undefined); assert.equal(labels.authors, undefined);
});

test('duplicate XMP fields prefer the first meaningful default title and deduplicate exact creators', async () => {
    const xml = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Description>
      <dc:title><rdf:Alt><rdf:li xml:lang="fr">Titre local</rdf:li><rdf:li xml:lang="x-default"><![CDATA[Research & Methods]]></rdf:li></rdf:Alt></dc:title>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Later duplicate</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>Ada</rdf:li><rdf:li>Ada</rdf:li><rdf:li>Alan</rdf:li><rdf:li></rdf:li><rdf:li>Creator: LaTeX</rdf:li></rdf:Seq></dc:creator>
      <dc:subject><rdf:Bag><rdf:li>Not a title or author</rdf:li></rdf:Bag></dc:subject>
    </rdf:Description></rdf:RDF>`;
    assert.deepEqual(xmpMetadata(xml), { title: 'Research & Methods', authors: ['Ada', 'Alan'] });
    const result = await validatePdf(metadataPdf('<< /Title () /Author () /Subject (Wrong field) /Keywords (Wrong author) >>', xml));
    assert.equal(result.title, 'Research & Methods'); assert.deepEqual(result.authors, ['Ada', 'Alan']);
    assert.deepEqual(xmpMetadata(xml.replace('Research & Methods', 'Research &bad; Methods').replace('<![CDATA[', '').replace(']]>', '')), {});
});
