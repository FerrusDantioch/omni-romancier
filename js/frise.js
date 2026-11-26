// =====================================================================
// FRISE DES ÉVÉNEMENTS (une page à part, ouverte depuis le plan ou l'onglet Événements)
// Les événements du roman, dans l'ordre, sur une ligne du temps, avec les personnages
// et les lieux concernés.
// « Qui apparaît où » montre d'un coup d'œil, pour chaque personnage et chaque lieu,
// les événements où il apparaît (une case par événement, dans l'ordre).
// Suivre un personnage ou un lieu met ses événements en valeur sur la frise.
//
// Adresse de la page : #roman/<identifiant>/frise. Le bouton « retour » du téléphone
// (ou du navigateur) ramène donc au texte, à l'endroit exact où l'on écrivait.
// =====================================================================

import { el, pluriel, estModeLibre } from "./outils.js";
import { informer } from "./dialogues.js";
import { etat, fichesDe, trouverFiche, deplacerEvenement, ecouter } from "./etat.js";
import { sauverMaintenant, retenirPosition, retrouverPosition, quitterConcentration } from "./editeur.js";
import { sauverFiche, afficherPanneau, ouvrirFiche, creerFiche, assurerPanneauVisible } from "./panneau.js";

const $ = (id) => document.getElementById(id);

const suivis = new Map();        // pour chaque roman : la fiche suivie (ou rien)
let presencesOuvertes = null;    // « Qui apparaît où » ouvert ou replié (null : selon la largeur de l'écran)
let ouverteParLeBouton = false;  // on vient de l'ouvrir depuis le texte (voir montrerFrise)
let enDepart = false;            // retour au texte déjà demandé (un double appui ne recule pas deux fois)
let ensuite = null;              // ce qu'il faut faire une fois revenu au texte (ouvrir une fiche…)
let montrerVue = null;           // (fourni par app.js : affiche une page et cache les autres)

// =====================================================================
// Mise en place
// =====================================================================

export function initialiserFrise({ montrer }) {
  montrerVue = montrer;
  $("bouton-frise").addEventListener("click", () => allerALaFrise());
  // « Voir la frise » (onglet Événements) et « Suivre sur la frise » (fiche d'un personnage ou d'un lieu)
  ecouter("voir-frise", (ficheId) => allerALaFrise(ficheId));

  const vue = $("vue-frise");
  vue.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || !vue.contains(b)) return;
    const { action, id } = b.dataset;
    if (action === "retour") quitter();
    else if (action === "nouvel") quitter(nouvelEvenement);
    else if (action === "ouvrir") quitter(() => montrerFiche(id));
    else if (action === "suivre") suivre(id, b);
    else if (action === "plus-tot") deplacer(id, -1);
    else if (action === "plus-tard") deplacer(id, +1);
  });
  // « Qui apparaît où » ouvert ou replié : on s'en souvient pendant la séance
  vue.addEventListener("toggle", (e) => {
    if (e.target.classList && e.target.classList.contains("presences")) presencesOuvertes = e.target.open;
  }, true);
  // Échap : retour au texte. Ctrl+S : par habitude… tout est déjà enregistré.
  // (Ctrl+P ouvre l'export PDF, comme dans le texte : voir export-pdf.js)
  document.addEventListener("keydown", (e) => {
    if (!friseAffichee() || document.querySelector("dialog[open]")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      quitter();
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      informer("Tout est déjà enregistré : l'ordre des événements comme le reste.");
    }
  });
}

export function friseAffichee() {
  return !$("vue-frise").hidden;
}

// Depuis le texte : ouvre la frise (en suivant éventuellement une fiche)
function allerALaFrise(ficheId = null) {
  if (!etat.roman) return;
  if (ficheId) suivis.set(etat.roman.id, ficheId);
  ouverteParLeBouton = true;
  location.hash = `roman/${encodeURIComponent(etat.roman.id)}/frise`;
}

// Retour au texte, puis éventuellement une action (ouvrir une fiche…)
function quitter(puis = null) {
  if (!etat.roman || enDepart) return;
  enDepart = true;
  ensuite = puis;
  // Ouverte depuis le texte : on recule d'un pas (le bouton « retour » ne ramènera pas à la frise).
  // Sur un onglet dupliqué (history.length <= 1) ou accès direct, on remplace par le texte.
  if (history.state?.friseDepuisLeTexte && history.length > 1) history.back();
  else location.replace(`#roman/${encodeURIComponent(etat.roman.id)}`);
}

// =====================================================================
// Passer du texte à la frise, et revenir (appelé par app.js selon l'adresse)
// =====================================================================

export async function montrerFrise() {
  enDepart = false;
  // Ouverte depuis le texte : on le note dans l'historique lui-même (la marque survit à un
  // rechargement de la page, et aux allers-retours « précédent » / « suivant »)
  if (ouverteParLeBouton && location.hash.endsWith("/frise")) {
    history.replaceState({ ...(history.state || {}), friseDepuisLeTexte: true }, "");
  }
  ouverteParLeBouton = false;
  if (!friseAffichee()) {
    // Tout est enregistré, et l'on retient où en était le texte
    await sauverMaintenant();
    await sauverFiche();
    retenirPosition();
    quitterConcentration();
    $("vue-roman").classList.remove("plan-ouvert", "panneau-ouvert"); // (volets du téléphone refermés)
    $("bouton-fiches").setAttribute("aria-expanded", "false");
    montrerVue("frise");
    $("vue-frise").scrollTop = 0;
  }
  document.title = "Frise — " + etat.roman.titre + " — Omni-Romancier";
  afficherFrise();
  $("titre-frise").focus({ preventScroll: true });
}

export async function revenirDeLaFrise() {
  if (!friseAffichee()) return;
  const action = ensuite;
  oublierFrise();
  montrerVue("roman");
  document.title = etat.roman.titre + " — Omni-Romancier";
  afficherPanneau();      // l'ordre des événements a pu changer
  // Curseur et défilement du texte, comme avant ; le clavier y retourne, sauf s'il doit aller dans une fiche
  retrouverPosition({ focus: !action });
  if (action) await action();
}

// On quitte le roman (ou l'on en ouvre un autre) : rien ne doit rester en attente
export function oublierFrise() {
  ensuite = null;
  ouverteParLeBouton = false;
  enDepart = false;
}

// Ouvrir une fiche dans le panneau (sur un écran moyen ou petit, le volet s'ouvre ; sur grand écran, le panneau est réaffiché)
function montrerFiche(id) {
  assurerPanneauVisible();
  return ouvrirFiche(id);
}
function nouvelEvenement() {
  assurerPanneauVisible();
  return creerFiche("evenement");
}

// =====================================================================
// Affichage
// =====================================================================

// Le personnage ou le lieu suivi (un événement ne se « suit » pas)
function ficheSuivie() {
  const f = trouverFiche(suivis.get(etat.roman.id));
  return f && f.categorie !== "evenement" ? f : null;
}

// L'événement concerne-t-il cette fiche ?
const concerne = (evenement, ficheId) =>
  (evenement.champs?.personnages || []).includes(ficheId) || (evenement.champs?.lieux || []).includes(ficheId);

function afficherFrise() {
  const vue = $("vue-frise");
  // (la page, et « Qui apparaît où » qui défile seul sur grand écran, restent où ils étaient)
  const defilement = vue.scrollTop;
  const defilementPresences = vue.querySelector(".presences")?.scrollTop || 0;
  const evenements = fichesDe("evenement");
  const suivi = ficheSuivie();
  const nombreSuivi = suivi ? evenements.filter((e) => concerne(e, suivi.id)).length : 0;

  vue.replaceChildren(el("div", { class: "frise-page" },
    vueTete(evenements),
    evenements.length
      ? el("div", { class: "frise-corps" },
          vuePresences(evenements, suivi),
          el("div", { class: "frise-colonne" },
            suivi ? vueSuivi(suivi, nombreSuivi, evenements.length) : null,
            el("ol", { class: "ligne-temps" + (suivi ? " avec-suivi" : ""), "aria-label": "Événements dans l'ordre" },
              evenements.map((e, i) => vueEvenement(e, i, evenements.length, suivi))),
          ),
        )
      : vueVide(),
  ));
  vue.scrollTop = defilement;
  const presences = vue.querySelector(".presences");
  if (presences) presences.scrollTop = defilementPresences;
}

function vueTete(evenements) {
  const libre = estModeLibre(etat.roman);
  return el("header", { class: "frise-tete" },
    el("button", { type: "button", class: "lien-retour", "data-action": "retour" }, "← Retour au texte"),
    el("div", { class: "frise-tete-ligne" },
      el("div", { class: "frise-titres" },
        el("p", { class: "etiquette" }, libre ? "Frise de l'intrigue" : "Frise des événements"),
        el("h1", { id: "titre-frise", tabindex: "-1" }, etat.roman.titre),
        evenements.length ? el("p", { class: "discret petit" },
          pluriel(evenements.length, "événement") + (libre ? ", dans l'ordre du récit" : ", dans l'ordre où ils se sont passés")) : null,
      ),
      evenements.length ? el("button", { type: "button", class: "bouton bouton-petit", "data-action": "nouvel" }, "+ Nouvel événement") : null,
    ),
  );
}

function vueVide() {
  const libre = estModeLibre(etat.roman);
  return el("div", { class: "vide frise-vide" },
    el("p", {}, "Aucun événement pour l'instant."),
    el("p", { class: "discret" }, (libre
      ? "Les événements sont les étapes clés de ton récit : élément déclencheur, rebondissement, révélation… "
      : "Les événements sont les grands moments de la partie : une rencontre, un combat, une révélation… ")
      + "Ajoute-les dans l'ordre où ils se déroulent, et relie-leur les personnages et les lieux concernés : "
      + "la frise montrera qui apparaît où."),
    el("button", { type: "button", class: "bouton", "data-action": "nouvel" }, "+ Nouvel événement"),
  );
}

// ---------- Un événement sur la ligne du temps ----------

function vueEvenement(e, i, total, suivi) {
  const titre = e.titre || "Sans titre";
  const quand = (e.champs?.quand || "").trim();
  const resume = (e.champs?.resume || "").trim();
  const enjeu = (e.champs?.enjeu || "").trim();
  const personnages = (e.champs?.personnages || []).map(trouverFiche).filter(Boolean);
  const lieux = (e.champs?.lieux || []).map(trouverFiche).filter(Boolean);
  const fleche = (action, symbole, libelle, inactif) =>
    el("button", { type: "button", class: "plan-action", "data-action": action, "data-id": e.id,
      "aria-label": `Placer « ${titre} » ${libelle.toLowerCase()}`, title: libelle, disabled: inactif }, symbole);

  return el("li", { class: "evt" + (suivi && concerne(e, suivi.id) ? " concerne" : ""), "data-id": e.id },
    // Le repère sur la ligne : un losange avec le numéro de l'événement
    el("div", { class: "evt-repere", "aria-hidden": "true" }, el("span", { class: "evt-losange" }, el("b", {}, i + 1))),
    quand ? el("p", { class: "evt-quand mono" }, quand) : null,
    el("article", { class: "evt-carte" },
      el("div", { class: "evt-entete" },
        el("h2", { class: "evt-titre" },
          el("button", { type: "button", "data-action": "ouvrir", "data-id": e.id, title: "Ouvrir la fiche" }, titre)),
        el("span", { class: "evt-actions" },
          fleche("plus-tot", "↑", "Plus tôt", i === 0),
          fleche("plus-tard", "↓", "Plus tard", i === total - 1),
        ),
      ),
      e.type ? el("span", { class: "statut evt-type", title: e.type }, e.type) : null,
      resume ? el("p", { class: "evt-resume" }, resume) : null,
      enjeu ? el("p", { class: "evt-enjeu" }, el("strong", {}, "Enjeu : "), enjeu) : null,
      personnages.length || lieux.length
        ? el("div", { class: "pastilles" }, [...personnages, ...lieux].map((f) => pastille(f, suivi)))
        : null,
    ),
  );
}

// Un personnage ou un lieu concerné : le toucher le suit sur la frise
function pastille(f, suivi) {
  const actif = suivi?.id === f.id;
  return el("button", {
    type: "button", class: "pastille" + (f.categorie === "lieu" ? " lieu" : ""),
    "data-action": "suivre", "data-id": f.id, "aria-pressed": String(actif),
    title: actif ? "Ne plus suivre" : "Suivre sur la frise",
  }, f.titre || "Sans nom");
}

// ---------- Le personnage ou le lieu suivi ----------

function vueSuivi(suivi, nombre, total) {
  return el("div", { class: "frise-suivi" },
    el("p", {}, "Tu suis ", el("strong", {}, suivi.titre || "Sans nom"), ` : ${pluriel(nombre, "événement")} sur ${total}.`),
    el("span", { class: "ligne" },
      el("button", { type: "button", class: "petit-bouton", "data-action": "ouvrir", "data-id": suivi.id }, "Ouvrir sa fiche"),
      el("button", { type: "button", class: "petit-bouton", "data-action": "suivre", "data-id": "" }, "Tout afficher"),
    ),
  );
}

// ---------- Qui apparaît où : une ligne par personnage ou lieu, une case par événement ----------

function vuePresences(evenements, suivi) {
  const total = evenements.length;
  // Les fiches qui apparaissent dans au moins un événement, par ordre d'entrée en scène
  const lignes = (fiches) => fiches
    .map((f) => {
      const cases = evenements.map((e) => concerne(e, f.id));
      return { f, cases, premier: cases.indexOf(true), nombre: cases.filter(Boolean).length };
    })
    .filter((l) => l.nombre > 0)
    .sort((a, b) => a.premier - b.premier);
  const personnages = [...lignes(fichesDe("principal")), ...lignes(fichesDe("pnj"))];
  const lieux = lignes(fichesDe("lieu"));

  const groupe = (nom, liste) => liste.length
    ? el("div", { class: "presences-groupe" },
        el("p", { class: "etiquette" }, nom),
        liste.map(({ f, cases, nombre }) => el("button", {
          type: "button", class: "presence" + (f.categorie === "lieu" ? " lieu" : ""),
          "data-action": "suivre", "data-id": f.id, "aria-pressed": String(suivi?.id === f.id),
          "aria-label": `${f.titre || "Sans nom"} : ${pluriel(nombre, "événement")} sur ${total}`,
        },
          el("span", { class: "presence-nom" }, f.titre || "Sans nom"),
          el("span", { class: "presence-cases" + (total > 40 ? " serrees" : ""), "aria-hidden": "true" },
            cases.map((c) => el("i", { class: c ? "plein" : null }))),
          el("span", { class: "presence-nombre mono", "aria-hidden": "true" }, nombre),
        )),
      )
    : null;

  const ouvert = presencesOuvertes ?? matchMedia("(min-width: 1000px)").matches;
  return el("details", { class: "presences", open: ouvert },
    el("summary", {}, el("span", { class: "etiquette" }, "Qui apparaît où"),
      el("span", { class: "discret petit" }, ` (${personnages.length + lieux.length})`)),
    personnages.length || lieux.length
      ? [
          groupe("Personnages", personnages),
          groupe("Lieux", lieux),
          el("p", { class: "discret petit" }, "Une case par événement, dans l'ordre. Choisis un nom pour le suivre sur la frise."),
        ]
      : el("p", { class: "discret petit" }, "Aucun personnage ni lieu n'est relié aux événements pour l'instant. "
          + "Pour en relier : ouvre un événement, puis « Modifier »."),
  );
}

// =====================================================================
// Suivre, réordonner
// =====================================================================

// Redessine la frise en gardant à la même place, à l'écran, l'élément « ancre »
// (celui qu'on vient de toucher : la page ne saute pas sous le doigt), puis lui rend le clavier
function redessiner(selecteur, ancre, ...autres) {
  const vue = $("vue-frise");
  const avant = ancre && ancre.isConnected ? ancre.getBoundingClientRect().top : null;
  afficherFrise();
  const cible = [selecteur, ...autres].map((s) => s && vue.querySelector(s)).find((b) => b && !b.disabled && b.getClientRects().length);
  if (cible && avant != null) {
    // Ce qui défile : « Qui apparaît où » s'il défile seul (grand écran), sinon la page
    const liste = cible.closest(".presences");
    const boite = liste && liste.scrollHeight > liste.clientHeight ? liste : vue;
    boite.scrollTop += cible.getBoundingClientRect().top - avant;
  }
  (cible || $("titre-frise")).focus({ preventScroll: true });
}

function suivre(id, bouton) {
  const ancien = suivis.get(etat.roman.id) || null;
  suivis.set(etat.roman.id, !id || id === ancien ? null : id);
  // Le même bouton, au même endroit (dans « Qui apparaît où » ou dans la carte de l'événement)
  const carte = bouton.closest(".evt");
  const ici = bouton.closest(".presences") ? ".presences "
    : carte ? `.evt[data-id="${CSS.escape(carte.dataset.id)}"] ` : null;
  if (ici) redessiner(`${ici}[data-action="suivre"][data-id="${CSS.escape(id)}"]`, bouton);
  // (« Tout afficher » disparaît : le clavier va sur la fiche qu'on suivait, dans « Qui apparaît où »)
  else redessiner(`.presences [data-id="${CSS.escape(ancien || "")}"]`, null);
}

async function deplacer(id, sens) {
  if (!await deplacerEvenement(id, sens)) return;
  // L'événement déplacé reste sous le doigt : ce sont ses voisins qui bougent
  const fleche = (a) => `.evt[data-id="${CSS.escape(id)}"] [data-action="${a}"]`;
  const ancre = $("vue-frise").querySelector(fleche(sens < 0 ? "plus-tot" : "plus-tard"));
  redessiner(fleche(sens < 0 ? "plus-tot" : "plus-tard"), ancre, fleche(sens < 0 ? "plus-tard" : "plus-tot"));
}
