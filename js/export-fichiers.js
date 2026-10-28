// =====================================================================
// EXPORT EN FICHIER : ePub (pour une liseuse) et Word (.docx, pour faire relire)
//
// Le contenu est le même que celui du PDF (voir export-pdf.js : contenuDuLivre) :
// le texte rédigé seulement, l'italique, le gras, les séparateurs « * * * ».
// Les deux formats sont des archives ZIP de fichiers texte (XML), fabriquées ici
// sans aucune dépendance (voir zip.js) : cela fonctionne hors ligne.
// Le seul nom qui figure dans les fichiers (auteur, page de titre) est le pseudonyme.
// =====================================================================

import { el, nouvelId } from "./outils.js";
import { creerZip } from "./zip.js";

export const AUTEUR = "Ferrus Dantioch";
export const SIGNATURE = "Réalisé par " + AUTEUR;

// =====================================================================
// Outils communs
// =====================================================================

// Le texte, prêt à être mis dans un fichier XML (caractères spéciaux protégés,
// caractères invisibles interdits retirés : ils rendraient le fichier illisible)
function xml(texte) {
  return String(texte)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const estSeparateur = (bloc) => bloc.classList.contains("livre-separateur");
// Un paragraphe qui suit un saut de page (voir blocsDuChapitre dans export-pdf.js)
const nouvellePage = (bloc) => bloc.classList.contains("livre-nouvelle-page");

// Le nom du fichier : le titre du roman (et ce qui est exporté), sans les caractères interdits
export function nomDeFichier(livre, extension) {
  const nom = [...(livre.nom || livre.titre)
    .replace(/[\u0000-\u001F\u007F]+/g, "")   // caractères invisibles : retirés
    .replace(/"/g, "'")                       // guillemets droits : apostrophes (« Le "Corbeau" » → « Le 'Corbeau' »)
    .replace(/[\\/:*?<>|]+/g, "-")             // caractères interdits dans un nom de fichier
    .replace(/\s+/g, " ").trim()]
    .slice(0, 120).join("")                   // (120 caractères au plus, sans couper un emoji en deux)
    .replace(/[\s.-]+$/, "");                // (ni espace, ni point, ni tiret juste avant l'extension)
  return (nom || "roman") + "." + extension;
}

// Date au format des métadonnées (« 2026-10-16T14:05:00Z »)
const dateIso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

// Fait télécharger le fichier (comme l'export des données)
export function telecharger(fichier, nom) {
  const lien = el("a", { href: URL.createObjectURL(fichier), download: nom });
  document.body.append(lien);
  lien.click();
  lien.remove();
  // (le fichier reste disponible une minute : le temps de répondre si le navigateur demande « Télécharger ? »)
  setTimeout(() => URL.revokeObjectURL(lien.href), 60000);
}

// =====================================================================
// ePub (version 3, avec le sommaire à l'ancienne pour les vieilles liseuses)
// =====================================================================

const XHTML = (titre, corps) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="fr" lang="fr">
<head>
<meta charset="UTF-8"/>
<title>${xml(titre)}</title>
<link rel="stylesheet" type="text/css" href="livre.css"/>
</head>
<body>
${corps}
</body>
</html>
`;

// La mise en page du livre (les liseuses gardent la main sur la police et sa taille)
const CSS_EPUB = `body { margin: 0 4%; line-height: 1.45; }
p { margin: 0; text-indent: 1.5em; text-align: justify; hyphens: auto; -epub-hyphens: auto; -webkit-hyphens: auto; }
p.premier { text-indent: 0; }
p.separateur { text-indent: 0; text-align: center; margin: 1em 0; }
p.nouvelle-page { text-indent: 0; page-break-before: always; break-before: page; }
h1, h2 { font-weight: normal; text-align: center; hyphens: none; -epub-hyphens: none; }
h2 { font-size: 1.5em; margin: 3em 0 2em; page-break-before: always; break-before: page; }
.page-titre { text-align: center; padding-top: 25%; }
.page-titre h1 { font-size: 2em; margin: 0 0 .6em; }
.page-titre .sous-titre { text-indent: 0; text-align: center; font-style: italic; }
.page-titre hr { width: 25%; margin: 2em auto; border: 0; border-top: 1px solid currentColor; }
.page-titre .signature { text-indent: 0; text-align: center; font-size: .85em; font-style: italic; }
nav ol { list-style: none; padding: 0; }
nav li { margin: .4em 0; }
`;

// Un paragraphe du livre (texte, <em>, <strong>) → XHTML
function enXhtml(noeud) {
  if (noeud.nodeType === Node.TEXT_NODE) return xml(noeud.data);
  const dedans = [...noeud.childNodes].map(enXhtml).join("");
  const balise = { EM: "em", STRONG: "strong" }[noeud.tagName];
  return balise ? `<${balise}>${dedans}</${balise}>` : dedans;
}

function chapitreEnXhtml(chapitre) {
  let suivant = "premier"; // le premier paragraphe d'un chapitre, et après un séparateur : sans retrait
  const paragraphes = chapitre.blocs.map((bloc) => {
    if (estSeparateur(bloc)) { suivant = "premier"; return `<p class="separateur">*&#160;&#160;*&#160;&#160;*</p>`; }
    if (nouvellePage(bloc)) suivant = "nouvelle-page"; // saut de page : nouvelle page, sans retrait
    const classe = suivant ? ` class="${suivant}"` : "";
    suivant = "";
    return `<p${classe}>${enXhtml(bloc)}</p>`;
  });
  return XHTML(chapitre.titre, `<section epub:type="chapter">\n<h2>${xml(chapitre.titre)}</h2>\n${paragraphes.join("\n")}\n</section>`);
}

// livre : { titre, sousTitre, pageDeTitre, idRoman, chapitres: [{ titre, blocs }] } → { fichier, nom }
export function creerEpub(livre, date = new Date()) {
  // Un identifiant stable pour le roman entier (une liseuse reconnaît alors une nouvelle version du même livre)
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(livre.idRoman || "") && !livre.sousTitre
    ? livre.idRoman : nouvelUuid();
  const titreComplet = livre.titre + (livre.sousTitre ? " — " + livre.sousTitre : "");
  const pages = [];
  if (livre.pageDeTitre) {
    pages.push({ id: "titre", fichier: "titre.xhtml", titre: livre.titre, contenu: XHTML(livre.titre, `<section class="page-titre" epub:type="titlepage">
<h1>${xml(livre.titre)}</h1>
${livre.sousTitre ? `<p class="sous-titre">${xml(livre.sousTitre)}</p>\n` : ""}<hr/>
<p class="signature">${xml(SIGNATURE)}</p>
</section>`) });
  }
  livre.chapitres.forEach((c, i) => pages.push({
    id: "chapitre-" + (i + 1), fichier: `chapitre-${i + 1}.xhtml`, titre: c.titre, chapitre: true, contenu: chapitreEnXhtml(c),
  }));
  const chapitres = pages.filter((p) => p.chapitre);

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="identifiant" xml:lang="fr">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="identifiant">urn:uuid:${uuid}</dc:identifier>
<dc:title>${xml(titreComplet)}</dc:title>
<dc:creator>${xml(AUTEUR)}</dc:creator>
<dc:language>fr</dc:language>
<meta property="dcterms:modified">${dateIso(date)}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="livre.css" media-type="text/css"/>
${pages.map((p) => `<item id="${p.id}" href="${p.fichier}" media-type="application/xhtml+xml"/>`).join("\n")}
</manifest>
<spine toc="ncx">
${pages.map((p) => `<itemref idref="${p.id}"/>`).join("\n")}
</spine>
</package>
`;
  const nav = XHTML("Sommaire", `<nav epub:type="toc" id="sommaire">
<h1>Sommaire</h1>
<ol>
${chapitres.map((p) => `<li><a href="${p.fichier}">${xml(p.titre)}</a></li>`).join("\n")}
</ol>
</nav>`);
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="fr">
<head>
<meta name="dtb:uid" content="urn:uuid:${uuid}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${xml(titreComplet)}</text></docTitle>
<docAuthor><text>${xml(AUTEUR)}</text></docAuthor>
<navMap>
${chapitres.map((p, i) => `<navPoint id="point-${i + 1}" playOrder="${i + 1}"><navLabel><text>${xml(p.titre)}</text></navLabel><content src="${p.fichier}"/></navPoint>`).join("\n")}
</navMap>
</ncx>
`;
  const conteneur = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;
  const fichier = creerZip([
    { nom: "mimetype", contenu: "application/epub+zip" }, // (toujours en premier, exigé par le format)
    { nom: "META-INF/container.xml", contenu: conteneur },
    { nom: "OEBPS/content.opf", contenu: opf },
    { nom: "OEBPS/nav.xhtml", contenu: nav },
    { nom: "OEBPS/toc.ncx", contenu: ncx },
    { nom: "OEBPS/livre.css", contenu: CSS_EPUB },
    ...pages.map((p) => ({ nom: "OEBPS/" + p.fichier, contenu: p.contenu })),
  ], "application/epub+zip", date);
  return { fichier, nom: nomDeFichier(livre, "epub") };
}

function nouvelUuid() {
  const id = nouvelId();
  return /^[0-9a-f-]{36}$/i.test(id) ? id
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

// =====================================================================
// Word (.docx) : un manuscrit classique, facile à relire et à annoter
// A4, Times New Roman 12, interligne 1,5, texte justifié, numéros de page en bas.
// Les chapitres utilisent le style « Titre 1 » (ils apparaissent dans le volet de navigation de Word).
// =====================================================================

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const ENTETE_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Un paragraphe du livre → des « morceaux » Word (texte en italique, en gras…)
function enMorceaux(noeud, style = { i: false, b: false }) {
  if (noeud.nodeType === Node.TEXT_NODE) {
    if (!noeud.data) return "";
    const rpr = (style.b ? "<w:b/><w:bCs/>" : "") + (style.i ? "<w:i/><w:iCs/>" : ""); // (gras avant italique : l'ordre de la norme)
    return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(noeud.data)}</w:t></w:r>`;
  }
  const suite = { i: style.i || noeud.tagName === "EM", b: style.b || noeud.tagName === "STRONG" };
  return [...noeud.childNodes].map((n) => enMorceaux(n, suite)).join("");
}

// (saut = true : le paragraphe commence une nouvelle page, comme après un saut de page)
const paragrapheWord = (style, contenu, saut = false) =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/>${saut ? "<w:pageBreakBefore/>" : ""}</w:pPr>${contenu}</w:p>`;
const texteWord = (texte) => `<w:r><w:t xml:space="preserve">${xml(texte)}</w:t></w:r>`;

function documentWord(livre) {
  const corps = [];
  if (livre.pageDeTitre) {
    corps.push(paragrapheWord("Title", texteWord(livre.titre)));
    if (livre.sousTitre) corps.push(paragrapheWord("Subtitle", texteWord(livre.sousTitre)));
    corps.push(paragrapheWord("SignatureLivre", texteWord(SIGNATURE)));
  }
  for (const chapitre of livre.chapitres) {
    corps.push(paragrapheWord("Heading1", texteWord(chapitre.titre))); // (chaque chapitre commence une nouvelle page)
    let premier = true; // le premier paragraphe, et celui qui suit un séparateur : sans retrait
    for (const bloc of chapitre.blocs) {
      if (estSeparateur(bloc)) { corps.push(paragrapheWord("Separateur", texteWord("* * *"))); premier = true; continue; }
      const saut = nouvellePage(bloc); // saut de page : nouvelle page, sans retrait
      corps.push(paragrapheWord(premier || saut ? "CorpsPremier" : "Corps", enMorceaux(bloc), saut));
      premier = false;
    }
  }
  // Mise en page : A4, marges de 2,5 cm, numéro de page en bas (sauf sur la page de titre)
  const page = `<w:sectPr>
<w:footerReference w:type="default" r:id="rIdPied"/>
${livre.pageDeTitre ? '<w:footerReference w:type="first" r:id="rIdPiedVide"/>' : ""}
<w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/>
${livre.pageDeTitre ? "<w:titlePg/>" : ""}
</w:sectPr>`;
  return `${ENTETE_XML}<w:document ${W} ${R}><w:body>
${corps.join("\n")}
${page}
</w:body></w:document>`;
}

const STYLES_WORD = `${ENTETE_XML}<w:styles ${W}>
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="fr-FR" w:eastAsia="fr-FR" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Corps"><w:name w:val="Texte du roman"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="425"/><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="CorpsPremier"><w:name w:val="Texte du roman (début)"/><w:basedOn w:val="Corps"/><w:next w:val="Corps"/><w:qFormat/><w:pPr><w:ind w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Separateur"><w:name w:val="Séparateur de scène"/><w:basedOn w:val="Normal"/><w:next w:val="CorpsPremier"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="240"/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="CorpsPremier"/><w:qFormat/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="2400" w:after="720" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="4000" w:after="480" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:iCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="SignatureLivre"><w:name w:val="Signature du livre"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="960"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:iCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
</w:styles>
`;

// (Word exige ces réglages dans l'ordre de sa norme : defaultTabStop avant autoHyphenation, etc.)
const REGLAGES_WORD = `${ENTETE_XML}<w:settings ${W}>
<w:defaultTabStop w:val="708"/>
<w:autoHyphenation/>
<w:characterSpacingControl w:val="doNotCompress"/>
<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>
<w:themeFontLang w:val="fr-FR"/>
</w:settings>
`;

const PIED_NUMERO = `${ENTETE_XML}<w:ftr ${W}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>
`;
const PIED_VIDE = `${ENTETE_XML}<w:ftr ${W}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr></w:p></w:ftr>
`;

// livre : { titre, sousTitre, pageDeTitre, chapitres: [{ titre, blocs }] } → { fichier, nom }
export function creerDocx(livre, date = new Date()) {
  const type = (t) => `application/vnd.openxmlformats-officedocument.${t}`;
  const typesDeContenu = `${ENTETE_XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="${type("wordprocessingml.document.main+xml")}"/>
<Override PartName="/word/styles.xml" ContentType="${type("wordprocessingml.styles+xml")}"/>
<Override PartName="/word/settings.xml" ContentType="${type("wordprocessingml.settings+xml")}"/>
<Override PartName="/word/footer1.xml" ContentType="${type("wordprocessingml.footer+xml")}"/>
<Override PartName="/word/footer2.xml" ContentType="${type("wordprocessingml.footer+xml")}"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="${type("extended-properties+xml")}"/>
</Types>
`;
  const lien = (id, t, cible) => `<Relationship Id="${id}" Type="${t}" Target="${cible}"/>`;
  const OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
  const liens = `${ENTETE_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${lien("rId1", OFFICE + "officeDocument", "word/document.xml")}
${lien("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml")}
${lien("rId3", OFFICE + "extended-properties", "docProps/app.xml")}
</Relationships>
`;
  const liensDocument = `${ENTETE_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${lien("rIdStyles", OFFICE + "styles", "styles.xml")}
${lien("rIdReglages", OFFICE + "settings", "settings.xml")}
${lien("rIdPied", OFFICE + "footer", "footer1.xml")}
${lien("rIdPiedVide", OFFICE + "footer", "footer2.xml")}
</Relationships>
`;
  const titreComplet = livre.titre + (livre.sousTitre ? " — " + livre.sousTitre : "");
  const proprietes = `${ENTETE_XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(titreComplet)}</dc:title>
<dc:creator>${xml(AUTEUR)}</dc:creator>
<cp:lastModifiedBy>${xml(AUTEUR)}</cp:lastModifiedBy>
<dc:language>fr-FR</dc:language>
<dcterms:created xsi:type="dcterms:W3CDTF">${dateIso(date)}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${dateIso(date)}</dcterms:modified>
</cp:coreProperties>
`;
  const application = `${ENTETE_XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Omni-Romancier</Application></Properties>
`;
  const fichier = creerZip([
    { nom: "[Content_Types].xml", contenu: typesDeContenu },
    { nom: "_rels/.rels", contenu: liens },
    { nom: "word/document.xml", contenu: documentWord(livre) },
    { nom: "word/_rels/document.xml.rels", contenu: liensDocument },
    { nom: "word/styles.xml", contenu: STYLES_WORD },
    { nom: "word/settings.xml", contenu: REGLAGES_WORD },
    { nom: "word/footer1.xml", contenu: PIED_NUMERO },
    { nom: "word/footer2.xml", contenu: PIED_VIDE },
    { nom: "docProps/core.xml", contenu: proprietes },
    { nom: "docProps/app.xml", contenu: application },
  ], type("wordprocessingml.document"), date);
  return { fichier, nom: nomDeFichier(livre, "docx") };
}
