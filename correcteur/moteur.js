// =====================================================================
// LE MOTEUR DU CORRECTEUR : vérifier un texte, proposer des corrections
//
// Ce fichier ne touche jamais à la page : il ne fait que des calculs.
// Il tourne dans un « Web Worker » (voir travailleur.js), c'est-à-dire en
// arrière-plan, pour que l'écriture ne soit jamais ralentie. Les tests
// automatiques s'en servent aussi directement.
//
// Le dictionnaire est une simple liste de mots (toutes les formes :
// « mange », « mangeaient »…), fabriquée une fois pour toutes par
// outils/dictionnaire/construire.mjs (dépôt omni-texte). Le format du
// fichier est expliqué dans ce script.
// =====================================================================

// Les lettres essayées pour les suggestions (les plus fréquentes d'abord)
const ALPHABET = "esntiarulodcpmévqfgbhàxèjyêzkwçôîâùûœïëü-'";

// Les lettres essayées sur les mots « repliés » (sans accents ni « h », voir replier)
const ALPHABET_REPLIE = 'esntiarulodcpmvqfgbxjyzkw';

// Quelques confusions fréquentes du français, en plus de celles du
// dictionnaire (« fesait » → « faisait », « emfant » → « enfant »…)
const CONFUSIONS = [
  ['e', 'ai'], ['ai', 'e'], ['an', 'en'], ['en', 'an'], ['in', 'ain'], ['ain', 'in'], ['in', 'ein'],
  ['m', 'n'], ['n', 'm'], ['er$', 'é'], ['é$', 'er'], ['ez$', 'er'], ['er$', 'ez'], ['é$', 'ée'],
  ['ée$', 'é'], ['s$', ''], ['x$', 's'], ['s$', 'x'], ['t$', ''], ['d$', 't'], ['t$', 'd'], ['g', 'gu'], ['gu', 'g'],
];

// Un « mot » du texte : des lettres et des chiffres, avec éventuellement
// des apostrophes ou des traits d'union au milieu (l'ami, peut-être)
const MOT = /[\p{L}\p{M}\p{N}]+(?:[-‐‑'’][\p{L}\p{M}\p{N}]+)*/gu;

// Ce qu'on ne vérifie pas : les adresses web et les adresses e-mail
const ADRESSES = /(?:https?:\/\/|www\.)[^\s<>"«»]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu;

// Les chiffres romains (XIXe, Ier, IIIe…)
const ROMAIN = /^[IVXLCDM]+(?:e|er|re|es|ème|èmes)?$/;

const CHIFFRE = /\p{N}/u;
const TRAIT = /[-‐‑]/;

// Les accents d'une lettre (pour savoir qu'« e » et « é » sont presque pareils)
const SANS_ACCENT = { à: 'a', â: 'a', ä: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e', î: 'i', ï: 'i', ô: 'o', ö: 'o', ù: 'u', û: 'u', ü: 'u', ç: 'c', ÿ: 'y' };
const base = (c) => SANS_ACCENT[c] || c;

// Le mot « replié » : en minuscules, sans accents, sans « h », sans trait
// d'union ni apostrophe, et sans lettres doublées. « Bibliothèque » et
// « biblioteque » donnent tous les deux « biblioteque » : c'est ce qui
// permet de retrouver vite un mot malgré plusieurs fautes d'accents.
function replier(mot) {
  let r = '';
  for (const c of mot.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')) {
    const b = base(c);
    if (b === 'h' || b === '-' || b === "'" || b === r[r.length - 1]) continue;
    r += b;
  }
  return r;
}
// (pour les distances : « œ » compte comme « oe »)
const deplier = (mot) => mot.replace(/œ/g, 'oe').replace(/æ/g, 'ae');

const majusculeInitiale = (m) => m.charAt(0).toUpperCase() + m.slice(1);
const minusculeInitiale = (m) => m.charAt(0).toLowerCase() + m.slice(1);
const estMajuscule = (c) => c !== c.toLowerCase() && c === c.toUpperCase();
const apostropheDroite = (m) => m.replace(/’/g, "'");

export class Moteur {
  /** @param {string} liste  le contenu du fichier mots-fr-….txt */
  constructor(liste) {
    this.mots = new Set();
    this.elisions = new Set();
    this.remplacements = []; // [ [cherché, remplacement], … ]
    this.acceptes = new Set(); // dictionnaire personnel, mots ignorés, noms des fiches
    this.memoire = new Map(); // mot → connu ? (pour ne pas refaire le travail)
    this.replies = null; // mot replié → mots (préparé à la première suggestion)
    this.lire(liste);
    for (const [cherche, remplace] of CONFUSIONS) this.remplacements.push([cherche, remplace]);
  }

  // ---------- Lecture du fichier ----------
  lire(liste) {
    let precedent = '';
    let entete = true;
    let debut = 0;
    while (debut < liste.length) {
      let fin = liste.indexOf('\n', debut);
      if (fin < 0) fin = liste.length;
      const ligne = liste.slice(debut, fin);
      debut = fin + 1;
      if (!ligne) continue;
      // L'en-tête s'arrête au premier mot (qui commence toujours par « 0 »)
      if (entete && ligne[0] !== '0') {
        if (ligne.startsWith('@elisions ')) ligne.slice(10).split(' ').forEach((e) => e && this.elisions.add(e));
        else if (ligne.startsWith('@rep ')) {
          const [cherche, remplace] = ligne.slice(5).split(' ');
          if (cherche && remplace) this.remplacements.push([cherche.replace(/ /g, ' '), remplace.replace(/ /g, ' ')]);
        }
        continue;
      }
      entete = false;
      // « 6s » après « maison » : on reprend 6 lettres, puis on ajoute « s »
      precedent = precedent.slice(0, ligne.charCodeAt(0) - 48) + ligne.slice(1);
      this.mots.add(precedent);
    }
  }

  /** Les mots acceptés en plus du dictionnaire (dictionnaire personnel…) */
  accepter(mots) {
    this.acceptes = new Set([...mots].map((m) => apostropheDroite(m.normalize('NFC'))));
    this.memoire.clear();
  }

  // ---------- Un mot est-il connu ? ----------
  // Règles des majuscules (comme Hunspell) : « Maison » est accepté si
  // « maison » existe (début de phrase) ; « MAISON » si « maison » ou
  // « Maison » existe. L'inverse n'est pas vrai : « paris » ne vaut pas « Paris ».
  existe(m) { return this.mots.has(m) || this.acceptes.has(m); }

  connu(mot) {
    const m = apostropheDroite(mot.normalize('NFC'));
    if (this.existe(m)) return true;
    if (m.length > 1 && m === m.toUpperCase() && m !== m.toLowerCase()) {
      const min = m.toLowerCase();
      return this.existe(min) || this.existe(majusculeInitiale(min));
    }
    if (estMajuscule(m.charAt(0))) return this.existe(minusculeInitiale(m));
    return false;
  }

  // ---------- Vérifier un texte ----------
  /**
   * Trouve les mots inconnus du texte.
   * @returns {{debut: number, fin: number, mot: string}[]}  positions dans le texte
   */
  verifier(texte) {
    const fautes = [];
    // Les zones à ne pas vérifier (adresses web et e-mail)
    const exclues = [];
    for (const a of texte.matchAll(ADRESSES)) exclues.push([a.index, a.index + a[0].length]);
    let e = 0;
    for (const trouve of texte.matchAll(MOT)) {
      const debut = trouve.index, fin = debut + trouve[0].length;
      while (e < exclues.length && exclues[e][1] <= debut) e++;
      if (e < exclues.length && exclues[e][0] < fin) continue;
      this.verifierMot(trouve[0], debut, fautes);
    }
    return fautes;
  }

  verifierMot(mot, debut, fautes) {
    if (mot.length < 2 || CHIFFRE.test(mot) || ROMAIN.test(mot)) return;
    if (this.estBon(mot)) return;
    // Élision : « l'amie », « qu'elle », « jusqu'à » → on vérifie la suite
    const apostrophe = mot.search(/['’]/);
    if (apostrophe > 0 && this.elisions.has(mot.slice(0, apostrophe).toLowerCase())) {
      this.verifierMot(mot.slice(apostrophe + 1), debut + apostrophe + 1, fautes);
      return;
    }
    // Trait d'union : « dit-il », « a-t-elle », « est-ce » → chaque morceau
    // est vérifié séparément, et seuls les morceaux inconnus sont signalés
    if (TRAIT.test(mot)) {
      let position = debut;
      for (const morceau of mot.split(TRAIT)) {
        if (morceau) this.verifierMot(morceau, position, fautes);
        position += morceau.length + 1;
      }
      return;
    }
    fautes.push({ debut, fin: debut + mot.length, mot });
  }

  estBon(mot) {
    let bon = this.memoire.get(mot);
    if (bon === undefined) {
      bon = this.connu(mot);
      if (this.memoire.size > 50000) this.memoire.clear();
      this.memoire.set(mot, bon);
    }
    return bon;
  }

  // ---------- Suggestions ----------
  /**
   * Propose jusqu'à « combien » corrections pour un mot inconnu.
   * Méthode : on fabrique toutes les variantes proches du mot (une lettre
   * oubliée, en trop, remplacée, deux lettres inversées, puis deux erreurs
   * à la fois), on garde celles qui existent, et on les classe : une erreur
   * d'accent ou de lettre doublée compte moins qu'une vraie faute de frappe.
   */
  suggerer(mot, combien = 5) {
    mot = apostropheDroite(mot.normalize('NFC'));
    // Écrit en majuscules, avec une majuscule au début, ou en minuscules ?
    const casse = mot.length > 1 && mot === mot.toUpperCase() ? 'tout' : estMajuscule(mot.charAt(0)) ? 'debut' : 'rien';
    const cle = casse === 'tout' ? mot.toLowerCase() : minusculeInitiale(mot);

    const trouves = new Map(); // mot proposé → note (plus petit = meilleur)
    const proposer = (forme, note = null) => {
      if (!forme || forme === cle) return;
      if (note === null) note = distance(deplier(cle), deplier(forme.toLowerCase() === forme ? forme : minusculeInitiale(forme)));
      if (forme.charAt(0) !== cle.charAt(0) && base(forme.charAt(0).toLowerCase()) !== base(cle.charAt(0))) note += 0.3;
      if (casse === 'rien' && forme !== forme.toLowerCase()) note += 0.4; // un nom propre pour un mot ordinaire
      const avant = trouves.get(forme);
      if (avant === undefined || note < avant) trouves.set(forme, note);
    };

    // 1. Les remplacements fréquents du français (ph/f, lettres doublées, ai/é…)
    for (const [cherche, remplace] of this.remplacements) {
      const auDebut = cherche.startsWith('^'), aLaFin = cherche.endsWith('$');
      const motif = cherche.replace(/^\^|\$$/g, '');
      let i = cle.indexOf(motif);
      while (i >= 0) {
        if ((!auDebut || i === 0) && (!aLaFin || i + motif.length === cle.length)) {
          // (comme dans Hunspell, ces corrections-là passent en premier)
          proposer(this.forme(cle.slice(0, i) + remplace + cle.slice(i + motif.length)), 0.6);
        }
        i = cle.indexOf(motif, i + 1);
      }
    }

    // 2. Une seule erreur (lettre oubliée, en trop, fausse, inversée)
    for (const v of variantes(cle, ALPHABET)) proposer(this.forme(v));

    // 3. Les fautes d'accents, de « h » et de lettres doublées, même
    //    nombreuses, plus une faute de frappe : on compare les mots repliés
    const index = this.indexReplie();
    const replie = replier(cle);
    for (const v of [replie, ...variantes(replie, ALPHABET_REPLIE)]) {
      if (this.mots.has(v)) proposer(v);
      const liste = index.get(v);
      if (typeof liste === 'string') proposer(liste);
      else if (liste) for (const forme of liste) proposer(forme);
    }

    // 4. Deux mots collés : « alorsque » → « alors que »
    for (let i = 1; i < cle.length; i++) {
      const gauche = cle.slice(0, i), droite = cle.slice(i);
      if ((gauche.length > 1 || 'aày'.includes(gauche)) && (droite.length > 1 || 'aày'.includes(droite))
        && this.mots.has(gauche) && this.mots.has(droite)) proposer(gauche + ' ' + droite, gauche.length > 1 && droite.length > 1 ? 0.9 : 1.2);
    }

    return [...trouves.entries()]
      .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || a[0].localeCompare(b[0], 'fr'))
      .slice(0, combien)
      .map(([forme]) => (casse === 'tout' ? forme.toUpperCase() : casse === 'debut' ? majusculeInitiale(forme) : forme));
  }

  // La forme sous laquelle un candidat existe (« paris » ou « Paris »), sinon null
  forme(candidat) {
    if (candidat.includes(' ')) return candidat.split(' ').every((m) => this.mots.has(m)) ? candidat : null;
    if (this.mots.has(candidat)) return candidat;
    const majuscule = majusculeInitiale(candidat);
    return this.mots.has(majuscule) ? majuscule : null;
  }

  // L'index des mots repliés. Seuls les mots qui changent en étant repliés
  // y figurent (les autres se trouvent directement dans la liste) : c'est
  // deux fois moins de mémoire.
  indexReplie() {
    if (this.replies) return this.replies;
    this.replies = new Map();
    for (const mot of this.mots) {
      const r = replier(mot);
      if (r === mot) continue;
      const avant = this.replies.get(r);
      if (avant === undefined) this.replies.set(r, mot);
      else if (typeof avant === 'string') this.replies.set(r, [avant, mot]);
      else avant.push(mot);
    }
    return this.replies;
  }
}

// Toutes les variantes d'un mot à une erreur près
function variantes(mot, alphabet) {
  const resultat = new Set();
  for (let i = 0; i <= mot.length; i++) {
    const avant = mot.slice(0, i), apres = mot.slice(i);
    if (apres) resultat.add(avant + apres.slice(1)); // une lettre en trop
    if (apres.length > 1) resultat.add(avant + apres[1] + apres[0] + apres.slice(2)); // deux lettres inversées
    for (const c of alphabet) {
      if (apres && c !== apres[0]) resultat.add(avant + c + apres.slice(1)); // une lettre fausse
      resultat.add(avant + c + apres); // une lettre oubliée
    }
  }
  resultat.delete(mot);
  return resultat;
}

// La « distance » entre deux mots : le coût des corrections pour passer de
// l'un à l'autre. Un accent oublié, une lettre doublée ou un « h » oublié
// coûtent peu ; une vraie faute de frappe coûte 1.
export function distance(a, b) {
  const n = a.length, m = b.length;
  const d = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  const coutAjout = (mot, j) => {
    const c = mot[j];
    if (c === '-' || c === "'" || c === 'h' || c === 'e') return 0.6;
    return c === mot[j - 1] || c === mot[j + 1] ? 0.5 : 1; // lettre doublée
  };
  for (let i = 1; i <= n; i++) d[i][0] = d[i - 1][0] + coutAjout(a, i - 1);
  for (let j = 1; j <= m; j++) d[0][j] = d[0][j - 1] + coutAjout(b, j - 1);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const x = a[i - 1], y = b[j - 1];
      const remplacer = x === y ? 0 : base(x) === base(y) ? 0.25 : 1;
      let v = Math.min(d[i - 1][j] + coutAjout(a, i - 1), d[i][j - 1] + coutAjout(b, j - 1), d[i - 1][j - 1] + remplacer);
      if (i > 1 && j > 1 && x === b[j - 2] && a[i - 2] === y) v = Math.min(v, d[i - 2][j - 2] + 0.7);
      d[i][j] = v;
    }
  }
  return d[n][m];
}
