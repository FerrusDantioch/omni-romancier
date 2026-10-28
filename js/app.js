// =====================================================================
// CHEF D'ORCHESTRE DE L'APPLICATION
// Il relie les différentes parties (pages, données, éditeur…).
// =====================================================================

import * as db from "./db.js";
import { UNIVERS } from "./outils.js";
import { informer } from "./dialogues.js";
import { initialiserBibliotheque, afficherBibliotheque } from "./bibliotheque.js";
import { initialiserSauvegarde, mettreAJourEtat } from "./sauvegarde.js";
import { chargerRoman, fermerRoman, etat } from "./etat.js";
import { initialiserPlan, afficherPlan } from "./plan.js";
import {
  initialiserEditeur, preparerEditeur, fermerEditeur, recupererSecours, effacerTousLesSecours, sauverMaintenant,
  toutEnregistrer,
} from "./editeur.js";
import { initialiserPanneau, preparerPanneau, fermerPanneau, sauverFiche } from "./panneau.js";
import { initialiserRecherche, fermerRecherche } from "./recherche.js";
import { initialiserRemplacement, fermerRemplacement } from "./remplacer.js";
import { initialiserAnnulation } from "./annulation.js";
import { demarrerSeul } from "./onglets.js";
import { initialiserExportPdf } from "./export-pdf.js";
import { initialiserHorsLigne } from "./hors-ligne.js";
import { initialiserReperage } from "./reperage.js";
import { initialiserSurlignage } from "./surlignage.js";
import { initialiserFrise, montrerFrise, revenirDeLaFrise, oublierFrise, friseAffichee } from "./frise.js";

// Numéro de version affiché dans « À propos »
export const VERSION = "1.10.0"; // (à changer aussi dans sw.js)

// Tous les fichiers de l'application se sont chargés ensemble (voir alerteDemarrage dans index.html)
window.applicationChargee = true;

// Liste des pages (« vues ») de l'application
const VUES = ["bibliotheque", "roman", "frise", "apropos"];

// Affiche une page et cache les autres
function montrer(nom) {
  for (const v of VUES) {
    document.getElementById("vue-" + v).hidden = v !== nom;
  }
  // Souligne le bon bouton du menu
  document.querySelectorAll(".nav [data-aller]").forEach((bouton) => {
    if (bouton.dataset.aller === nom) bouton.setAttribute("aria-current", "page");
    else bouton.removeAttribute("aria-current");
  });
}

// Change la couleur d'accent de toute l'interface (liseré, étiquettes, puces)
function colorerUnivers(univers) {
  document.documentElement.dataset.univers = UNIVERS[univers] ? univers : "autre";
}

// Les changements de page se font l'un après l'autre, jamais deux en même temps
// (sinon deux clics rapides sur « Précédent » pourraient s'emmêler)
let fileDAttente = Promise.resolve();
function enOrdre(action) {
  fileDAttente = fileDAttente.then(action).catch(signalerErreur);
  return fileDAttente;
}
const suivreAdresseEnOrdre = () => enOrdre(suivreAdresse);

// Lit l'adresse (#bibliotheque, #apropos, #roman/identifiant, #roman/identifiant/frise)
// et affiche la bonne page
async function suivreAdresse() {
  const [page, id, sousPage] = location.hash.slice(1).split("/");
  fermerRecherche();
  fermerRemplacement();

  if (page === "roman" && id) {
    const romanId = decodeURIComponent(id);
    const dejaOuvert = etat.roman && etat.roman.id === romanId
      && (!document.getElementById("vue-roman").hidden || friseAffichee());
    if (!dejaOuvert && !await ouvrirRoman(romanId)) return;
    // Le texte, ou la frise des événements de ce roman
    if (sousPage === "frise") await montrerFrise();
    else await revenirDeLaFrise();
    return;
  }

  // On quitte la page d'écriture : on enregistre tout avant
  oublierFrise();
  await fermerPanneau();
  await fermerEditeur();
  fermerRoman();
  document.body.classList.remove("mode-ecriture");
  colorerUnivers("autre");
  document.title = "Omni-Romancier";
  if (page === "apropos") {
    montrer("apropos");
  } else {
    await afficherBibliotheque();
    montrer("bibliotheque");
    await mettreAJourEtat();
  }
}

// Charge un roman et affiche sa page d'écriture. Renvoie false s'il n'existe plus.
async function ouvrirRoman(romanId) {
  oublierFrise();
  await fermerPanneau();
  await fermerEditeur();
  await recupererSecours(); // frappes restées en secours (enregistrement qui avait échoué) : on les remet d'abord
  const roman = await chargerRoman(romanId);
  if (!roman) {
    informer("Ce roman n'existe plus.", { erreur: true });
    location.hash = "bibliotheque";
    return false;
  }
  colorerUnivers(roman.univers);
  document.title = roman.titre + " — Omni-Romancier";
  document.body.classList.add("mode-ecriture");
  montrer("roman");
  afficherPlan();
  await preparerEditeur();
  await preparerPanneau();
  return true;
}

// Tout problème inattendu est signalé (au lieu de laisser l'application bloquée en silence)
function signalerErreur(erreur) {
  console.error(erreur);
  const message = (erreur && erreur.message) || String(erreur);
  informer(`Un problème est survenu : ${message}. Si cela se répète, exportez vos données puis rechargez la page.`,
    { erreur: true, duree: 12000 });
}
window.addEventListener("unhandledrejection", (e) => signalerErreur(e.reason));
window.addEventListener("error", (e) => signalerErreur(e.error || e.message));

// Démarrage
async function demarrer() {
  document.getElementById("numero-version").textContent = VERSION;

  // Tous les boutons qui portent data-aller="..." changent de page
  document.addEventListener("click", (e) => {
    const bouton = e.target.closest("[data-aller]");
    // On change l'adresse (#apropos…) : le bouton « retour » du navigateur fonctionne
    if (bouton) location.hash = bouton.dataset.aller;
  });
  window.addEventListener("hashchange", suivreAdresseEnOrdre);

  try {
    await db.ouvrirBase();
  } catch (erreur) {
    window.alerteDemarrage("le stockage du navigateur est indisponible : " + erreur.message);
    return;
  }
  // Demande au navigateur de protéger nos données (sans bloquer le démarrage)
  db.protegerStockage().then(mettreAJourEtat);
  // L'identité de cet appareil : chaque modification la retient (pour la fusion entre appareils)
  await db.monAppareil();

  // Récupère d'éventuelles frappes non enregistrées (onglet fermé en pleine phrase…)
  await recupererSecours();

  initialiserBibliotheque({ quandCaChange: mettreAJourEtat });
  initialiserSauvegarde({
    quandImporte: () => enOrdre(async () => {
      effacerTousLesSecours();
      fermerRoman();               // force le rechargement du roman affiché
      await suivreAdresse();
    }),
    // Avant un export : on enregistre les toutes dernières frappes (texte et fiche).
    // Renvoie false si quelque chose n'a pas pu être enregistré.
    avantExporter: async () => {
      const texteOk = await toutEnregistrer();
      const ficheOk = await sauverFiche();
      return texteOk && ficheOk;
    },
  });
  initialiserPlan();
  initialiserEditeur();
  initialiserPanneau();
  initialiserReperage();
  initialiserSurlignage();
  initialiserFrise({ montrer });
  initialiserRecherche();
  initialiserRemplacement();
  initialiserExportPdf();
  initialiserHorsLigne();
  // Ctrl+Z dans le texte du roman ne défait jamais une modification faite ailleurs
  initialiserAnnulation((champ) => champ.id === "texte-notes" || champ.id === "texte-redige");

  await suivreAdresseEnOrdre();
  await mettreAJourEtat();
}

// On démarre dès que cette page est la seule ouverte (voir onglets.js).
// Si une autre page demande la main, on enregistre tout avant de la lui céder.
demarrerSeul(
  () => demarrer().catch((erreur) => window.alerteDemarrage(erreur.message)),
  async () => { await sauverMaintenant(); await sauverFiche(); },
);
