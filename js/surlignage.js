// =====================================================================
// NOMS EN COULEUR DANS LE TEXTE
// Les personnages et les lieux des fiches nommés dans la scène sont soulignés en couleur,
// directement dans le texte (mêmes règles que « Dans cette scène » : voir reperage.js).
// Les lieux ont un soulignement en pointillés.
// Toucher (ou cliquer) un nom coloré fait apparaître une petite bulle qui ouvre sa fiche ;
// Ctrl+clic (Cmd+clic sur Mac) l'ouvre directement. Le curseur reste dans le texte.
//
// Comment ça marche : une zone de texte (textarea) ne sait pas colorer une partie de son texte.
// On place donc derrière elle un « calque » qui contient exactement le même texte, à la même
// place (même police, mêmes marges, même défilement), invisible sauf les noms soulignés.
// Le texte que l'on voit et que l'on tape reste celui de la zone de texte : si le calque
// était un jour décalé, seul le soulignement serait mal placé, jamais le texte.
// Pour rester rapide dans une longue scène, le calque a une ligne par paragraphe,
// et à chaque frappe on ne refait que les lignes qui ont changé (sans jamais rien retirer de la page :
// voir majCalque, c'est ce qui garde Ctrl+Z intact).
// Chaque zone de texte (Notes, Rédigé) a son propre calque : côte à côte, les deux sont colorées.
//
// Le même calque souligne aussi les fautes d'orthographe (vague rouge adoucie, voir orthographe.js) :
// toucher un mot souligné ouvre alors la bulle de corrections.
// =====================================================================

import { el, STYLES_DU_TEXTE, placeDuTexte } from "./outils.js";
import { etat, ecouter, trouverFiche } from "./etat.js";
import { CATEGORIES, ouvrirFiche, basculerVolet } from "./panneau.js";
import { estReperable, preparerNoms, nomsDansLeTexte, signatureDesNoms } from "./reperage.js";
import { correcteur, fautesDeLigne, initialiserOrthographe, proposerCorrections, fermerBulle as fermerCorrections, replacerBulle } from "./orthographe.js";

// Le choix « noms en couleur », propre à cet appareil (gardé dans le navigateur)
const CLE_CHOIX = "atelier-surlignage";

let actif = true;
let noms = [];             // les noms à chercher (ceux des fiches repérables du roman)
let signature = "";        // les noms ont-ils changé ? (sinon, inutile de tout refaire)
let demande = 0;           // mise à jour prévue au prochain affichage
let bulleSur = null;       // { copie, marque, morceau } : le nom sous lequel la bulle est affichée

// Les deux calques, un par zone de texte. Pour chacun :
//   lignes : le texte de chaque ligne du calque, tel qu'il est affiché
//   elements : l'élément de chaque ligne (dans l'ordre ; les lignes cachées n'y sont plus)
//   aNettoyer : des lignes cachées ou des noms vidés attendent le ménage
//   construit : le calque est rempli (il est vidé quand sa zone de texte est cachée)
const copies = [];

const $ = (id) => document.getElementById(id);

// =====================================================================
// Mise en place
// =====================================================================

export function initialiserSurlignage() {
  try { actif = localStorage.getItem(CLE_CHOIX) !== "non"; } catch { /* stockage indisponible : on colore */ }
  $("surligner").checked = actif;
  $("surligner").addEventListener("change", (e) => {
    actif = e.target.checked;
    try { localStorage.setItem(CLE_CHOIX, actif ? "oui" : "non"); } catch { /* tant pis : le choix vaut pour cette fois */ }
    cacherBulle();
    planifier(null, true);
  });

  for (const mode of ["notes", "redige"]) {
    const zone = $("texte-" + mode), calque = $("calque-" + mode);
    const copie = {
      zone, calque, interieur: calque.querySelector(".calque-texte"),
      lignes: [], elements: [], aNettoyer: false, construit: false, signature: null, styles: "",
      aFaire: false, toutRefaire: false,
    };
    copies.push(copie);
    zone.addEventListener("input", () => { cacherBulle(); fermerCorrections(); planifier(copie); });
    zone.addEventListener("scroll", () => suivreDefilement(copie));
    zone.addEventListener("click", (e) => surClic(e, copie));
    zone.addEventListener("keydown", (e) => { if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) cacherBulle(); });
    // Le curseur a peut-être quitté le mot que l'on tapait : il peut être souligné
    zone.addEventListener("keyup", () => { if (copie.differee) majFautes(copie); });
    zone.addEventListener("pointerup", () => { if (copie.differee) majFautes(copie); });
    // On ne tape plus dans ce texte : le moment de faire le ménage du calque, sans gêner Ctrl+Z
    zone.addEventListener("blur", () => {
      if (copie.aNettoyer) planifier(copie, true);
      else if (copie.differee) majFautes(copie);
    });
    // Taille changée (fenêtre, volets, concentration, barre de défilement…) : les lignes se recoupent.
    // Deux surveillances : la place du texte (une barre de défilement qui apparaît la réduit),
    // et la taille totale (sur grand écran, élargir la fenêtre n'élargit que les marges du texte).
    new ResizeObserver(() => planifier(copie)).observe(zone);
    new ResizeObserver(() => planifier(copie)).observe(zone, { box: "border-box" });
  }
  ecouter("scene-affichee", () => { cacherBulle(); planifier(null, true); });
  // (Notes, Rédigé ou les deux : chaque calque regarde si sa zone de texte est affichée)
  ecouter("mode-affiche", () => { cacherBulle(); planifier(); });
  ecouter("fiches-changees", () => planifier()); // (tout est refait seulement si un nom a changé)
  // Correcteur : réglage changé (tout est refait), ou nouvelles fautes connues (seules les lignes concernées)
  initialiserOrthographe((tout) => {
    if (tout) planifier(null, true);
    else for (const c of copies) majFautes(c);
  });

  const bulle = $("bulle-noms");
  bulle.addEventListener("mousedown", (e) => e.preventDefault()); // toucher la bulle ne retire pas le curseur du texte
  bulle.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fiche]");
    if (b) ouvrir(b.dataset.fiche);
  });
  // Toucher ailleurs que dans le texte ou la bulle : elle disparaît
  document.addEventListener("pointerdown", (e) => {
    if (!bulle.hidden && !bulle.contains(e.target) && !e.target.closest?.(".texte")) cacherBulle();
  });
}

// Prévoit la mise à jour d'un calque (ou des deux, sans « copie »)
function planifier(copie = null, tout = false) {
  for (const c of copie ? [copie] : copies) {
    c.aFaire = true;
    if (tout) c.toutRefaire = true;
  }
  if (demande) return;
  // Juste avant le prochain affichage (plusieurs frappes très rapprochées ne font qu'une mise à jour)
  demande = requestAnimationFrame(() => {
    demande = 0;
    // Les noms à chercher : refaits seulement si une fiche a changé de nom (ou de catégorie)
    const fiches = etat.roman ? etat.fiches.filter(estReperable) : [];
    const sig = signatureDesNoms(fiches);
    if (sig !== signature) { signature = sig; noms = preparerNoms(fiches); }
    for (const c of copies) {
      if (!c.aFaire) continue;
      // Page d'écriture cachée (frise…) : rien à mesurer, on attend son retour (qui redemande une mise à jour)
      if (!c.zone.hidden && !c.zone.offsetParent) continue;
      const tout = c.toutRefaire;
      c.aFaire = c.toutRefaire = false;
      majCalque(c, tout, fiches.length > 0);
    }
  });
}

// =====================================================================
// Le calque
// =====================================================================

function majCalque(copie, tout, desNoms) {
  const { zone, calque, interieur } = copie;
  copie.avecNoms = actif && desNoms;
  const visible = (copie.avecNoms || correcteur.actif) && !!etat.sceneId && !$("editeur-plein").hidden && !zone.hidden;
  calque.hidden = !visible;
  if (!visible) {
    // Zone de texte cachée (ou rien à colorer) : son calque est vidé, il sera refait à son retour
    if (copie.construit) interieur.replaceChildren();
    Object.assign(copie, { lignes: [], elements: [], aNettoyer: false, construit: false });
    if (bulleSur?.copie === copie) cacherBulle();
    return;
  }
  if (!copie.construit || copie.signature !== signature) tout = true;
  copie.construit = true;
  copie.signature = signature;
  copierStyles(copie);
  const nouvelles = zone.value.split("\n");
  noterCurseur(copie);

  // Tout refaire (autre scène, autre mode, autres noms…) : on cherche dans tout le texte d'un coup
  // (plus rapide), puis on donne à chaque ligne ses noms. (Un nom coupé par un retour à la ligne n'est pas souligné.)
  if (tout) {
    const parLigne = repartir(copie.avecNoms ? nomsDansLeTexte(zone.value, noms) : [], nouvelles);
    const morceau = document.createDocumentFragment();
    copie.aNettoyer = false;
    copie.elements = nouvelles.map((texte, i) => morceau.appendChild(remplirLigne(copie, document.createElement("div"), texte, parLigne[i], i)));
    interieur.replaceChildren(morceau);
    copie.lignes = nouvelles;
    suivreDefilement(copie);
    return;
  }

  // Pendant l'écriture : seulement les lignes qui ont changé (entre le début et la fin restés identiques).
  // ATTENTION : rien n'est retiré de la page pendant que l'on tape. Chrome couperait sinon ce que l'on
  // tape en petits morceaux, et Ctrl+Z n'annulerait plus qu'une lettre à la fois. On réécrit donc le texte
  // des lignes existantes, on en ajoute au besoin, et une ligne en trop est seulement cachée
  // (le ménage se fait au prochain « tout refaire »).
  const { lignes, elements } = copie;
  const max = Math.min(lignes.length, nouvelles.length);
  let debut = 0, fin = 0;
  while (debut < max && lignes[debut] === nouvelles[debut]) debut++;
  while (fin < max - debut && lignes[lignes.length - 1 - fin] === nouvelles[nouvelles.length - 1 - fin]) fin++;
  const finAncien = lignes.length - fin, finNouveau = nouvelles.length - fin;
  const communes = Math.min(finAncien, finNouveau) - debut;
  for (let i = debut; i < debut + communes; i++) remplirLigne(copie, elements[i], nouvelles[i], nomsDeLaLigne(copie, nouvelles[i]), i);
  if (finNouveau > finAncien) {
    // Des lignes en plus : ajoutées juste avant la première ligne restée identique à la fin
    const suivante = elements[finAncien] || null;
    const ajout = [];
    for (let i = debut + communes; i < finNouveau; i++) {
      const ligne = remplirLigne(copie, document.createElement("div"), nouvelles[i], nomsDeLaLigne(copie, nouvelles[i]), i);
      interieur.insertBefore(ligne, suivante);
      ajout.push(ligne);
    }
    elements.splice(debut + communes, 0, ...ajout);
  } else if (finAncien > finNouveau) {
    // Des lignes en moins : cachées
    for (const ligne of elements.splice(debut + communes, finAncien - finNouveau)) ligne.hidden = true;
    copie.aNettoyer = true;
  }
  copie.lignes = nouvelles;
  suivreDefilement(copie);
}

// Les noms trouvés dans tout le texte, rangés par ligne (positions comptées depuis le début de leur ligne)
function repartir(trouves, lignesDuTexte) {
  const parLigne = lignesDuTexte.map(() => []);
  let k = 0, debutLigne = 0;
  lignesDuTexte.forEach((texte, i) => {
    const finLigne = debutLigne + texte.length;
    for (; k < trouves.length && trouves[k].debut < finLigne; k++) {
      const n = trouves[k];
      if (n.debut >= debutLigne && n.fin <= finLigne) parLigne[i].push({ ...n, debut: n.debut - debutLigne, fin: n.fin - debutLigne });
    }
    debutLigne = finLigne + 1; // (+1 : le retour à la ligne)
  });
  return parLigne;
}

const nomsDeLaLigne = (copie, texte) => (copie.avecNoms ? nomsDansLeTexte(texte, noms) : []);

// Où est le curseur (ligne, colonne) si l'on écrit dans ce texte : le mot que l'on est en train
// de taper n'est pas souligné tant que le curseur est juste à sa fin
function noterCurseur(copie) {
  const { zone } = copie;
  copie.curseur = null;
  copie.differee = false;
  if (document.activeElement !== zone || zone.selectionStart !== zone.selectionEnd) return;
  const avant = zone.value.slice(0, zone.selectionStart);
  const debutLigne = avant.lastIndexOf("\n") + 1;
  let ligne = 0;
  for (let i = avant.indexOf("\n"); i >= 0; i = avant.indexOf("\n", i + 1)) ligne++;
  copie.curseur = { ligne, colonne: zone.selectionStart - debutLigne };
}

// Les fautes d'une ligne, à souligner (sauf le mot en cours de frappe, et ce qui touche un nom)
function fautesAffichees(copie, texte, numero, nomsTrouves) {
  let fautes = fautesDeLigne(texte);
  const c = copie.curseur;
  if (c && c.ligne === numero && fautes.some((f) => f.fin === c.colonne)) {
    fautes = fautes.filter((f) => f.fin !== c.colonne);
    copie.differee = true;
  }
  return nomsTrouves.length ? fautes.filter((f) => !nomsTrouves.some((n) => f.debut < n.fin && n.debut < f.fin)) : fautes;
}

// Les fautes connues ont changé (vérification terminée, mot ajouté au dictionnaire…) : seules
// les lignes dont les fautes ont changé sont réécrites (sans rien retirer de la page : voir majCalque)
function majFautes(copie) {
  if (!copie.construit || copie.calque.hidden) return;
  noterCurseur(copie);
  copie.elements.forEach((ligne, i) => {
    const fautes = fautesAffichees(copie, copie.lignes[i], i, ligne.noms || []);
    if (signatureDesFautes(fautes) !== ligne.fautes) remplirLigne(copie, ligne, copie.lignes[i], ligne.noms || [], i, fautes);
  });
}

const signatureDesFautes = (fautes) => fautes.map((f) => f.debut + "-" + f.fin).join(" ");

// Écrit une ligne (un paragraphe) du calque, avec ses noms et ses fautes soulignés.
// Une ligne est toujours faite ainsi : texte, marque, texte, marque, …, texte. On réutilise ce qui existe
// (on change seulement les textes) ; une marque en trop devient vide, elle resservira plus tard.
function remplirLigne(copie, ligne, texte, nomsTrouves, numero, fautes = fautesAffichees(copie, texte, numero, nomsTrouves)) {
  // (gardés pour pouvoir réécrire seulement les fautes plus tard : voir majFautes)
  ligne.noms = nomsTrouves;
  ligne.fautes = signatureDesFautes(fautes);
  const trouves = fautes.length
    ? [...nomsTrouves, ...fautes.map((f) => ({ ...f, faute: true }))].sort((a, b) => a.debut - b.debut)
    : nomsTrouves;
  const noeuds = ligne.childNodes;
  if (!noeuds.length) ligne.append(document.createTextNode(""));
  for (let n = (noeuds.length - 1) / 2; n < trouves.length; n++) {
    const marque = document.createElement("mark");
    marque.append(document.createTextNode(""));
    ligne.append(marque, document.createTextNode(""));
  }
  const ecrire = (noeud, valeur) => { if (noeud.data !== valeur) noeud.data = valeur; };
  // (une ligne vide garde sa hauteur grâce à un caractère invisible)
  ecrire(noeuds[0], texte ? texte.slice(0, trouves.length ? trouves[0].debut : texte.length) : "\u200b");
  for (let j = 0; 2 * j + 1 < noeuds.length; j++) {
    const marque = noeuds[2 * j + 1], n = trouves[j];
    if (n) {
      ecrire(marque.firstChild, texte.slice(n.debut, n.fin));
      const classe = n.faute ? "faute" : n.fiches.every((f) => f.categorie === "lieu") ? "lieu" : "";
      if (marque.className !== classe) marque.className = classe;
      // Un nom : les fiches qu'il désigne ; une faute : sa place dans la ligne
      const ids = n.faute ? "" : n.fiches.map((f) => f.id).join(" ");
      if (marque.dataset.fiches !== ids) marque.dataset.fiches = ids;
      if (n.faute) marque.dataset.debut = n.debut;
      ecrire(noeuds[2 * j + 2], texte.slice(n.fin, trouves[j + 1] ? trouves[j + 1].debut : texte.length));
    } else {
      ecrire(marque.firstChild, "");
      if (marque.className !== "vide") { marque.className = "vide"; delete marque.dataset.fiches; copie.aNettoyer = true; }
      ecrire(noeuds[2 * j + 2], "");
    }
  }
  return ligne;
}

// Le calque prend exactement la place, la police et les marges de la zone de texte
// (sans sa barre de défilement : sinon les lignes ne seraient pas coupées au même endroit ;
// la place est prise au centième de pixel près : voir placeDuTexte dans outils.js)
function copierStyles(copie) {
  const { zone, calque, interieur } = copie;
  const cs = getComputedStyle(zone);
  const { gauche, haut, largeur, hauteur } = placeDuTexte(zone);
  const styles = STYLES_DU_TEXTE.map((p) => cs[p]).join("|") + "|" + [gauche, haut, largeur, hauteur].join("|");
  if (styles === copie.styles) return;
  copie.styles = styles;
  calque.style.left = gauche + "px";
  calque.style.top = haut + "px";
  calque.style.width = largeur + "px";
  calque.style.height = hauteur + "px";
  for (const p of STYLES_DU_TEXTE) interieur.style[p] = cs[p];
}

// Le calque défile avec le texte (et la bulle suit son nom)
function suivreDefilement(copie) {
  if (!copie.construit) return;
  copie.calque.scrollTop = copie.zone.scrollTop;
  copie.calque.scrollLeft = copie.zone.scrollLeft;
  if (bulleSur?.copie === copie) placerBulle();
  replacerBulle();
}

// =====================================================================
// La bulle : toucher un nom coloré propose d'ouvrir sa fiche
// =====================================================================

function surClic(e, copie) {
  cacherBulle();
  const { zone } = copie;
  if (!copie.construit || copie.calque.hidden || zone.selectionStart !== zone.selectionEnd) return;
  const trouve = marqueSous(copie, e.clientX, e.clientY);
  if (!trouve) return;
  // Une faute d'orthographe : la bulle de corrections
  if (trouve.marque.classList.contains("faute")) {
    const { marque, morceau } = trouve;
    const ligne = marque.parentNode;
    const numero = copie.elements.indexOf(ligne);
    let position = Number(marque.dataset.debut);
    for (let i = 0; i < numero; i++) position += copie.lignes[i].length + 1;
    proposerCorrections(zone, position, marque.textContent, () => {
      if (marque.parentNode !== ligne || !marque.classList.contains("faute") || copie.calque.hidden) return null;
      const r = marque.getClientRects()[morceau];
      const vue = copie.calque.getBoundingClientRect();
      return r && r.bottom >= vue.top && r.top <= vue.bottom ? r : null; // mot sorti de la partie visible : la bulle se ferme
    });
    return;
  }
  if (!actif || document.body.classList.contains("concentration")) return;
  const ids = trouve.marque.dataset.fiches.split(" ").filter((id) => trouverFiche(id));
  if (!ids.length) return;
  if (e.ctrlKey || e.metaKey) { ouvrir(ids[0]); return; } // Ctrl+clic : la fiche s'ouvre tout de suite
  const bulle = $("bulle-noms");
  bulle.replaceChildren(...ids.map((id) => {
    const f = trouverFiche(id);
    return el("button", { type: "button", class: "bulle-fiche", "data-fiche": id, title: "Ouvrir la fiche" },
      el("span", { class: "bulle-categorie" }, CATEGORIES[f.categorie].nom),
      el("span", { class: "bulle-nom" }, f.titre || "Sans nom"),
      el("span", { "aria-hidden": "true" }, "›"),
    );
  }));
  bulle.hidden = false;
  bulleSur = trouve;
  placerBulle();
}

// Le nom coloré qui se trouve sous le point touché (dans la ligne où le curseur vient d'arriver)
function marqueSous(copie, x, y) {
  const { zone } = copie;
  let numero = 0;
  for (let i = zone.value.indexOf("\n"); i >= 0 && i < zone.selectionStart; i = zone.value.indexOf("\n", i + 1)) numero++;
  const ligne = copie.elements[numero];
  if (!ligne) return null;
  for (const marque of ligne.querySelectorAll("mark:not(.vide)")) {
    const rects = [...marque.getClientRects()];
    const r = rects.findIndex((b) => x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2);
    if (r >= 0) return { copie, marque, morceau: r };
  }
  return null;
}

// La bulle se place juste sous le nom (ou au-dessus, s'il est tout en bas)
function placerBulle() {
  const bulle = $("bulle-noms");
  const { copie, marque, morceau } = bulleSur;
  const rects = marque.isConnected ? [...marque.getClientRects()] : [];
  const r = rects[morceau] || rects[0];
  // Le nom est sorti de la partie visible de son texte (texte qui défile) : la bulle disparaît
  const vue = copie.calque.getBoundingClientRect();
  if (!r || r.bottom < vue.top || r.top > vue.bottom) { cacherBulle(); return; }
  const boite = $("zone-ecriture").getBoundingClientRect();
  const largeur = bulle.offsetWidth, hauteur = bulle.offsetHeight;
  let haut = r.bottom - boite.top + 6;
  if (haut + hauteur > boite.height - 8) haut = r.top - boite.top - hauteur - 6;
  bulle.style.top = Math.max(4, haut) + "px";
  bulle.style.left = Math.max(8, Math.min(r.left - boite.left, boite.width - largeur - 8)) + "px";
}

export function cacherBulle() {
  bulleSur = null;
  $("bulle-noms").hidden = true;
}

function ouvrir(id) {
  cacherBulle();
  // Écran moyen ou petit : le panneau est un volet, on l'ouvre
  if (getComputedStyle($("panneau")).position === "fixed") basculerVolet(true);
  ouvrirFiche(id, { focus: false });
}
