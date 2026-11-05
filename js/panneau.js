// =====================================================================
// PANNEAU DE CONSULTATION (colonne de droite)
// 4 onglets : Personnages principaux, PNJ, Lieux, Événements.
// On lit et on modifie les fiches sans quitter l'écriture.
// Deux fiches au plus peuvent être épinglées (par exemple, deux personnages principaux) :
// elles restent affichées en haut du panneau.
// =====================================================================

import * as db from "./db.js";
import { el, nouvelId } from "./outils.js";
import { confirmer, informer } from "./dialogues.js";
import {
  etat, trouverFiche, fichesDe, annoncer, ecouter, deplacerEvenement, evenementsDe, chapitresTries, scenesDe, trouverScene,
  fichesEpinglees, estEpinglee, noterEpinglees, MAX_EPINGLEES,
} from "./etat.js";
import { revenirAuTexte, allerAuNom } from "./editeur.js";
import { estReperable, passagesDeLaScene, toutEstLu, quandToutEstLu } from "./reperage.js";

// « Autres noms » : surnoms qui servent aussi à repérer la fiche dans le texte (voir reperage.js)
const AUTRES_NOMS = ["autresNoms", "Autres noms"];

// Les catégories de fiches et leurs champs (clé du champ, libellé)
export const CATEGORIES = {
  principal: {
    onglet: "Principal", nom: "Personnage principal", nouveau: "Nouveau personnage principal",
    exempleType: "Héroïne, mercenaire, enquêteur…",
    champs: [AUTRES_NOMS, ["apparence", "Apparence"], ["caractere", "Caractère"], ["background", "Background de départ"], ["relations", "Relations"]],
  },
  pnj: {
    onglet: "PNJ", nom: "PNJ", nouveau: "Nouveau PNJ",
    exempleType: "Allié, rival, marchand…",
    champs: [AUTRES_NOMS, ["apparence", "Apparence"], ["caractere", "Caractère"], ["background", "Background"], ["relations", "Relations"]],
  },
  lieu: {
    onglet: "Lieux", nom: "Lieu", nouveau: "Nouveau lieu",
    exempleType: "Ville, taverne, vaisseau…",
    champs: [AUTRES_NOMS, ["description", "Description"], ["ambiance", "Ambiance"]],
  },
  evenement: {
    onglet: "Événements", nom: "Événement", nouveau: "Nouvel événement",
    exempleType: "Combat, rencontre, révélation…",
    champs: [["quand", "Date ou moment"], ["resume", "Résumé"]],
  },
};
// Les champs d'une ligne (courts) ; les autres sont des zones de texte
const CHAMPS_COURTS = ["quand", "autresNoms"];
const EXEMPLES = { autresNoms: "Surnoms, séparés par des virgules : la Vieille, Corbeau…" };
const DELAI_SAUVEGARDE = 400;
// « Nommé dans ces scènes » : mis à jour un instant après la dernière touche (pas à chaque touche)
const DELAI_SCENES = 600;

// Ce que montre le panneau en ce moment
const vue = {
  onglet: "principal",   // onglet ouvert
  ficheId: null,         // fiche ouverte (null = la liste)
  edition: false,        // true = formulaire de modification
  repliees: new Set(),   // les fiches épinglées réduites à leur nom
};

let ficheModifiee = null;   // fiche en attente d'enregistrement
let minuterie = null;
let minuterieScenes = null;

const $ = (id) => document.getElementById(id);

// =====================================================================
// Mise en place
// =====================================================================

export function initialiserPanneau() {
  const panneau = $("panneau");

  // Onglets : clic, et flèches ← → au clavier
  const onglets = [...document.querySelectorAll("[data-onglet]")];
  onglets.forEach((b, i) => {
    b.addEventListener("click", () => changerOnglet(b.dataset.onglet));
    b.addEventListener("keydown", (e) => {
      const sens = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!sens) return;
      e.preventDefault();
      const suivant = onglets[(i + sens + onglets.length) % onglets.length];
      changerOnglet(suivant.dataset.onglet);
      suivant.focus();
    });
  });

  // Tous les boutons du panneau (data-action="...")
  panneau.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || !panneau.contains(b)) return;
    const { action, id } = b.dataset;
    if (action === "ouvrir-fiche") ouvrirFiche(id);
    else if (action === "liste") retourListe();
    else if (action === "nouvelle") creerFiche(vue.onglet);
    else if (action === "modifier") ouvrirFiche(id, { edition: true });
    else if (action === "termine") terminerEdition();
    else if (action === "supprimer-fiche") supprimerFiche(id);
    else if (action === "epingler") epingler(id);
    else if (action === "desepingler") desepingler(id);
    else if (action === "replier") replierEpinglee(id);
    else if (action === "monter") deplacer(id, -1);
    else if (action === "descendre") deplacer(id, +1);
    else if (action === "voir-frise") annoncer("voir-frise", id || null); // (la frise suit cette fiche, s'il y en a une)
    else if (action === "aller-au-nom") { basculerVolet(false); allerAuNom(id, b.dataset.fiche); } // (petit écran : le volet laisse voir le texte)
  });

  // « Nommé dans ces scènes » suit l'écriture (et le titre de la scène), l'ouverture d'une autre scène
  // et les changements du plan
  for (const id of ["texte-notes", "texte-redige", "titre-scene"]) {
    $(id).addEventListener("input", () => {
      clearTimeout(minuterieScenes);
      minuterieScenes = setTimeout(majSceneOuverte, DELAI_SCENES);
    });
  }
  for (const annonce of ["scene-affichee", "plan-change", "scene-renommee", "fiches-changees"]) ecouter(annonce, refaireScenesNommees);

  // Échap dans le panneau : retour au texte, curseur à sa place
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || $("vue-roman").hidden || document.querySelector("dialog[open]")) return;
    const dansPanneau = panneau.contains(document.activeElement);
    const voletOuvert = $("vue-roman").classList.contains("panneau-ouvert");
    const clavierPerdu = document.activeElement === document.body || document.activeElement === null;
    if (!dansPanneau && !voletOuvert && !clavierPerdu) return;
    e.preventDefault();
    sauverFiche();
    $("vue-roman").classList.remove("panneau-ouvert");
    revenirAuTexte();
  });

  // Écran moyen ou petit : le panneau devient un volet
  $("bouton-fiches").addEventListener("click", () => basculerVolet());
  $("fermer-panneau").addEventListener("click", () => { basculerVolet(false); revenirAuTexte(); });

  // Filet de sécurité : enregistrer la fiche si la page se cache ou se ferme
  document.addEventListener("visibilitychange", () => { if (document.hidden) sauverFiche(); });
  window.addEventListener("pagehide", () => sauverFiche());
}

// Ouvre ou ferme le volet (écrans moyens et petits)
export function basculerVolet(forcer) {
  const v = $("vue-roman");
  const ouvert = v.classList.toggle("panneau-ouvert", forcer);
  if (ouvert) v.classList.remove("plan-ouvert"); // un seul volet à la fois
  $("bouton-fiches").setAttribute("aria-expanded", String(ouvert));
  return ouvert;
}

// Après le chargement d'un roman : on retrouve l'état du panneau laissé la dernière fois
export async function preparerPanneau() {
  ficheModifiee = null;
  const memo = await db.lireReglage("panneau:" + etat.roman.id, {});
  vue.onglet = CATEGORIES[memo.onglet] ? memo.onglet : "principal";
  vue.ficheId = trouverFiche(memo.ficheId) ? memo.ficheId : null;
  vue.edition = false;
  vue.repliees = new Set(Array.isArray(memo.repliees) ? memo.repliees : []);
  // (version précédente : une seule fiche épinglée, repliée ou non)
  if (memo.epingleeRepliee && etat.roman.ficheEpinglee) vue.repliees.add(etat.roman.ficheEpinglee);
  afficherPanneau();
}

export async function fermerPanneau() {
  await sauverFiche();
  $("vue-roman").classList.remove("panneau-ouvert");
}

function memoriserVue() {
  if (!etat.roman) return;
  db.ecrireReglage("panneau:" + etat.roman.id, {
    onglet: vue.onglet, ficheId: vue.ficheId,
    repliees: [...vue.repliees].filter(estEpinglee), // (seulement celles qui sont encore épinglées)
  });
}

// =====================================================================
// Navigation dans le panneau
// =====================================================================

function changerOnglet(onglet) {
  if (vue.onglet === onglet && !vue.ficheId) return;
  sauverFiche();
  vue.onglet = onglet;
  vue.ficheId = null;
  vue.edition = false;
  afficherPanneau();
  $("contenu-panneau").scrollTop = 0;
}

// Ouvre une fiche dans le panneau (utilisé aussi par la recherche Ctrl+K)
// « selection » : en modification, sélectionne tout le nom (pour le remplacer en tapant)
export function ouvrirFiche(id, { edition = false, focus = true, selection = false } = {}) {
  const fiche = trouverFiche(id);
  if (!fiche) return;
  sauverFiche();
  vue.onglet = fiche.categorie;
  vue.ficheId = id;
  vue.edition = edition;
  afficherPanneau();
  $("contenu-panneau").scrollTop = 0; // on commence la lecture en haut de la fiche
  if (focus) {
    // En lecture : le titre de la fiche ; en modification : le premier champ
    const cible = edition ? $("contenu-panneau").querySelector("input, textarea") : $("contenu-panneau").querySelector(".fiche-titre");
    if (cible) cible.focus({ preventScroll: true });
    if (edition && cible && cible.setSelectionRange) {
      if (selection) cible.select();
      else cible.setSelectionRange(cible.value.length, cible.value.length);
    }
  }
}

function retourListe() {
  sauverFiche();
  const ancienne = vue.ficheId;
  vue.ficheId = null;
  vue.edition = false;
  afficherPanneau();
  // Le clavier revient sur la fiche qu'on vient de quitter, dans la liste
  const b = $("contenu-panneau").querySelector(`[data-action="ouvrir-fiche"][data-id="${CSS.escape(ancienne || "")}"]`);
  if (b) b.focus({ preventScroll: true });
}

async function terminerEdition() {
  await sauverFiche();
  vue.edition = false;
  afficherPanneau();
  const titre = $("contenu-panneau").querySelector(".fiche-titre");
  if (titre) titre.focus({ preventScroll: true });
}

function replierEpinglee(id) {
  if (vue.repliees.has(id)) vue.repliees.delete(id);
  else vue.repliees.add(id);
  afficherEpinglee();
  memoriserVue();
  const b = $("epinglee").querySelector(`[data-action="replier"][data-id="${CSS.escape(id || "")}"]`);
  if (b) b.focus();
}

// =====================================================================
// Affichage
// =====================================================================

export function afficherPanneau() {
  if (!etat.roman) return;
  document.querySelectorAll("[data-onglet]").forEach((b) => {
    const actif = b.dataset.onglet === vue.onglet;
    b.setAttribute("aria-selected", String(actif));
    b.tabIndex = actif ? 0 : -1;
  });
  $("contenu-panneau").setAttribute("aria-labelledby", "onglet-" + vue.onglet);
  afficherEpinglee();
  afficherContenu();
  memoriserVue();
}

// Les fiches épinglées (deux au plus), toujours visibles en haut du panneau
function afficherEpinglee() {
  const zone = $("epinglee");
  const fiches = fichesEpinglees();
  zone.replaceChildren();
  zone.hidden = !fiches.length;
  zone.append(...fiches.map((fiche) => {
    const repliee = vue.repliees.has(fiche.id);
    return el("div", { class: "epinglee-fiche" },
      el("div", { class: "epinglee-tete" },
        el("span", { class: "etiquette" }, "📌 Épinglé"),
        el("button", { type: "button", class: "lien-discret", "data-action": "replier", "data-id": fiche.id,
          "aria-expanded": String(!repliee), "aria-label": `${repliee ? "Déplier" : "Replier"} « ${fiche.titre || "Sans nom"} »` },
        repliee ? "Déplier" : "Replier"),
      ),
      repliee
        ? el("button", { type: "button", class: "epinglee-titre-seul", "data-action": "ouvrir-fiche", "data-id": fiche.id }, fiche.titre || "Sans nom")
        : vueLecture(fiche, { compacte: true }),
    );
  }));
}

function afficherContenu() {
  const zone = $("contenu-panneau");
  zone.replaceChildren();
  const fiche = vue.ficheId ? trouverFiche(vue.ficheId) : null;
  if (fiche && vue.edition) zone.append(vueEdition(fiche));
  else if (fiche) zone.append(vueLecture(fiche, { compacte: false }));
  else zone.append(vueListe(vue.onglet));
}

// ---------- La liste d'un onglet ----------

function vueListe(categorie) {
  const cat = CATEGORIES[categorie];
  const fiches = fichesDe(categorie);
  const bouton = el("button", { type: "button", class: "petit-bouton nouvelle-fiche", "data-action": "nouvelle" }, "+ " + cat.nouveau);
  if (fiches.length === 0) {
    return el("div", { class: "liste-vide" },
      el("p", { class: "discret petit" }, messageVide(categorie)),
      bouton,
    );
  }
  if (categorie === "evenement") {
    return el("div", { class: "liste-fiches" },
      el("div", { class: "ligne" },
        bouton,
        el("button", { type: "button", class: "petit-bouton", "data-action": "voir-frise" }, "Voir la frise"),
      ),
      el("ol", { class: "frise", "aria-label": "Événements dans l'ordre" },
        fiches.map((f, i) => el("li", { class: "frise-item" },
          el("button", { type: "button", class: "frise-ouvrir", "data-action": "ouvrir-fiche", "data-id": f.id },
            f.champs?.quand ? el("span", { class: "frise-quand mono" }, f.champs.quand) : null,
            el("span", { class: "frise-titre" }, f.titre || "Sans titre"),
            f.champs?.resume ? el("span", { class: "frise-resume" }, f.champs.resume) : null,
          ),
          el("span", { class: "frise-actions" },
            el("button", { type: "button", class: "plan-action", "data-action": "monter", "data-id": f.id,
              "aria-label": `Monter l'événement « ${f.titre} »`, title: "Plus tôt", disabled: i === 0 }, "↑"),
            el("button", { type: "button", class: "plan-action", "data-action": "descendre", "data-id": f.id,
              "aria-label": `Descendre l'événement « ${f.titre} »`, title: "Plus tard", disabled: i === fiches.length - 1 }, "↓"),
          ),
        )),
      ),
    );
  }
  return el("div", { class: "liste-fiches" },
    bouton,
    // Un seul personnage principal : on rappelle qu'on peut en avoir un deuxième (épinglé lui aussi)
    categorie === "principal" && fiches.length === 1
      ? el("p", { class: "discret petit" }, "Un deuxième personnage principal ? Créez sa fiche : elle sera épinglée elle aussi.")
      : null,
    el("ul", { class: "fiches" },
      fiches.map((f) => el("li", {},
        el("button", { type: "button", class: "fiche-item", "data-action": "ouvrir-fiche", "data-id": f.id },
          el("span", { class: "fiche-item-titre" }, f.titre || "Sans nom"),
          f.type ? el("span", { class: "fiche-item-type" }, f.type) : null,
          estEpinglee(f.id) ? el("span", { class: "fiche-item-epingle", title: "Épinglée" }, "📌") : null,
        ),
      )),
    ),
  );
}

function messageVide(categorie) {
  return {
    principal: "Aucune fiche de personnage principal. Créez-la (et celle d'un deuxième, s'il y en a deux) : "
      + "elles resteront épinglées en haut du panneau pendant que vous écrivez.",
    pnj: "Aucun PNJ pour l'instant.",
    lieu: "Aucun lieu pour l'instant.",
    evenement: "Aucun événement pour l'instant. Ajoutez-les dans l'ordre où ils se sont passés.",
  }[categorie];
}

// ---------- Une fiche, en lecture ----------

function vueLecture(fiche, { compacte }) {
  const cat = CATEGORIES[fiche.categorie];
  const epinglee = estEpinglee(fiche.id);
  const champs = cat.champs
    .filter(([cle]) => (fiche.champs?.[cle] || "").trim())
    .map(([cle, libelle]) => [el("dt", {}, libelle), el("dd", {}, fiche.champs[cle])]);
  if ((fiche.notes || "").trim()) champs.push([el("dt", {}, "Notes"), el("dd", {}, fiche.notes)]);

  return el("article", { class: "fiche" + (compacte ? " compacte" : "") },
    compacte ? null : el("button", { type: "button", class: "lien-retour", "data-action": "liste" }, "← " + cat.onglet),
    el("div", { class: "fiche-tete" },
      el(compacte ? "p" : "h2", { class: "fiche-titre", tabindex: "-1" }, fiche.titre || "Sans nom"),
      fiche.type ? el("span", { class: "statut" }, fiche.type) : null,
    ),
    champs.length
      ? el("dl", { class: "fiche-champs" }, champs)
      : el("p", { class: "discret petit" }, "Fiche vide pour l'instant."),
    // (la fiche épinglée reste compacte : sans la liste des événements liés, ni celle des scènes)
    fiche.categorie === "evenement" ? vueConcernes(fiche) : compacte ? null : [vueEvenementsLies(fiche), vueScenesNommees(fiche)],
    el("div", { class: "fiche-actions" },
      el("button", { type: "button", class: "petit-bouton", "data-action": "modifier", "data-id": fiche.id }, "✎ Modifier"),
      epinglee
        ? el("button", { type: "button", class: "petit-bouton", "data-action": "desepingler", "data-id": fiche.id }, "Désépingler")
        : el("button", { type: "button", class: "petit-bouton", "data-action": "epingler", "data-id": fiche.id }, "📌 Épingler"),
    ),
  );
}

// Événement : les personnages et lieux concernés, sous forme d'étiquettes cliquables
function vueConcernes(fiche) {
  const liens = [...(fiche.champs?.personnages || []), ...(fiche.champs?.lieux || [])]
    .map(trouverFiche).filter(Boolean);
  if (!liens.length) return null;
  return el("div", { class: "fiche-liens" },
    el("p", { class: "etiquette" }, "Concernés"),
    el("div", { class: "pastilles" },
      liens.map((f) => el("button", { type: "button", class: "pastille", "data-action": "ouvrir-fiche", "data-id": f.id },
        f.titre || "Sans nom")),
    ),
  );
}

// Personnage ou lieu : les événements où il apparaît
function vueEvenementsLies(fiche) {
  const evenements = evenementsDe(fiche.id);
  if (!evenements.length) return null;
  return el("div", { class: "fiche-liens" },
    el("p", { class: "etiquette" }, "Apparaît dans"),
    el("ul", { class: "losanges petit" },
      evenements.map((e) => el("li", {},
        el("button", { type: "button", class: "lien-discret", "data-action": "ouvrir-fiche", "data-id": e.id },
          (e.champs?.quand ? e.champs.quand + " — " : "") + (e.titre || "Sans titre")),
      )),
    ),
    el("button", { type: "button", class: "lien-discret petit suivre-frise", "data-action": "voir-frise", "data-id": fiche.id },
      "Suivre sur la frise"),
  );
}

// Personnage ou lieu : les scènes où il est nommé (texte rédigé ou notes), chapitre par chapitre.
// Toucher une scène l'ouvre au passage où il est nommé ; toucher la scène ouverte va au passage suivant.
// La scène ouverte a toujours sa ligne (cachée si le nom n'y est pas) : pendant que l'on écrit,
// elle est seulement mise à jour (voir majSceneOuverte).
// Si le roman n'est pas encore tout lu (juste après son ouverture, ou un nom de fiche changé),
// « Recherche dans le roman… » s'affiche un instant, puis la liste se remplit : elle est seulement
// ajoutée, sans rien retirer de la page (on peut être en train d'écrire à ce moment-là).
function vueScenesNommees(fiche) {
  if (!estReperable(fiche)) return null;
  const pret = toutEstLu();
  const bloc = el("div", { class: "fiche-liens scenes-nommees-bloc", "data-fiche": fiche.id },
    el("p", { class: "etiquette" }, "Nommé dans ces scènes"),
    el("p", { class: "discret petit scenes-nommees-attente", hidden: pret }, "Recherche dans le roman…"),
    el("p", { class: "discret petit scenes-nommees-vide", hidden: true }, "Pas encore nommé dans le texte du roman."),
    el("ol", { class: "scenes-nommees" }),
  );
  if (pret) remplirScenesNommees(bloc, fiche);
  else quandToutEstLu(() => { if (bloc.isConnected && trouverFiche(fiche.id)) remplirScenesNommees(bloc, fiche); });
  return bloc;
}

function remplirScenesNommees(bloc, fiche) {
  const chapitres = chapitresTries().map((c) => {
    const lignes = scenesDe(c.id)
      .map((s) => ({ s, n: comptes(fiche.id, s) }))
      .filter(({ s, n }) => n.total || s.id === etat.sceneId)
      .map(({ s, n }) => ligneScene(fiche, s, n));
    if (!lignes.length) return null;
    return el("li", { class: "scenes-nommees-chapitre", hidden: lignes.every((l) => l.hidden) },
      el("span", { class: "scenes-nommees-chapitre-titre" }, c.titre || "Sans titre"),
      el("ul", {}, lignes),
    );
  }).filter(Boolean);
  bloc.querySelector(".scenes-nommees").append(...chapitres);
  bloc.querySelector(".scenes-nommees-vide").hidden = !chapitres.every((c) => c.hidden);
  bloc.querySelector(".scenes-nommees-attente").hidden = true;
}

function ligneScene(fiche, s, n) {
  const ici = s.id === etat.sceneId;
  return el("li", { "data-scene": s.id, hidden: !n.total },
    el("button", {
      type: "button", class: "scene-nommee" + (ici ? " ici" : ""), "data-action": "aller-au-nom", "data-id": s.id, "data-fiche": fiche.id,
      "aria-current": ici ? "true" : false, title: detailDesFois(n, ici),
    },
      el("span", { class: "scene-nommee-titre" }, s.titre || "Sans titre"),
      el("span", { class: "scene-nommee-nombre" }, nombreDeFois(n)),
    ),
  );
}

// Combien de fois la fiche est nommée dans une scène (la scène ouverte : son texte tel qu'il est à l'écran)
function comptes(ficheId, s) {
  const textes = s.id === etat.sceneId ? { notes: $("texte-notes").value, texte: $("texte-redige").value } : s;
  const p = passagesDeLaScene(s, textes).get(ficheId);
  const redige = p ? p.redige.length : 0, notes = p ? p.notes.length : 0;
  return { redige, notes, total: redige + notes };
}
const nombreDeFois = (n) => n.total + " fois" + (n.total && !n.redige ? " (notes)" : "");
function detailDesFois(n, ici) {
  const parties = [];
  if (n.redige) parties.push(`${n.redige} dans le texte rédigé`);
  if (n.notes) parties.push(`${n.notes} dans les notes`);
  return parties.join(", ") + (ici ? " — scène ouverte : toucher pour aller au passage suivant" : " — toucher pour y aller");
}

// Pendant l'écriture : seule la ligne de la scène ouverte peut changer. On change seulement
// des textes et des attributs, sans rien retirer de la page (Chrome couperait sinon ce que l'on
// tape en petits morceaux, et Ctrl+Z n'annulerait plus qu'une lettre à la fois).
function majSceneOuverte() {
  const bloc = $("contenu-panneau").querySelector(".scenes-nommees-bloc");
  const s = trouverScene(etat.sceneId);
  const li = bloc && s && bloc.querySelector(`li[data-scene="${CSS.escape(s.id)}"]`);
  if (!li) return;
  const n = comptes(bloc.dataset.fiche, s);
  const texte = li.querySelector(".scene-nommee-nombre").firstChild;
  if (texte.data !== nombreDeFois(n)) texte.data = nombreDeFois(n);
  const titre = li.querySelector(".scene-nommee-titre").firstChild; // (scène renommée dans son titre, au-dessus du texte)
  if (titre.data !== (s.titre || "Sans titre")) titre.data = s.titre || "Sans titre";
  const bouton = li.querySelector(".scene-nommee");
  if (bouton.title !== detailDesFois(n, true)) bouton.title = detailDesFois(n, true);
  if (li.hidden !== !n.total) li.hidden = !n.total;
  const chapitre = li.closest(".scenes-nommees-chapitre");
  const chapitreVide = [...chapitre.querySelectorAll("li[data-scene]")].every((x) => x.hidden);
  if (chapitre.hidden !== chapitreVide) chapitre.hidden = chapitreVide;
  const vide = bloc.querySelector(".scenes-nommees-vide");
  const aucune = [...bloc.querySelectorAll(".scenes-nommees-chapitre")].every((x) => x.hidden);
  if (vide.hidden !== !aucune) vide.hidden = !aucune;
}

// Autre scène ouverte, plan ou noms changés : la liste est refaite (on n'est pas en train d'écrire)
function refaireScenesNommees() {
  clearTimeout(minuterieScenes);
  const bloc = $("contenu-panneau").querySelector(".scenes-nommees-bloc");
  if (!bloc) return;
  const fiche = trouverFiche(bloc.dataset.fiche);
  const nouveau = fiche && vueScenesNommees(fiche);
  if (!nouveau) { bloc.remove(); return; }
  const defilement = bloc.querySelector(".scenes-nommees").scrollTop; // (une longue liste garde sa place)
  bloc.replaceWith(nouveau);
  nouveau.querySelector(".scenes-nommees").scrollTop = defilement;
}

// ---------- Une fiche, en modification ----------

function vueEdition(fiche) {
  const cat = CATEGORIES[fiche.categorie];
  fiche.champs ||= {};
  const idListe = "types-" + fiche.categorie;
  const typesExistants = [...new Set(fichesDe(fiche.categorie).map((f) => f.type).filter(Boolean))];

  // Chaque modification met à jour la fiche, puis l'enregistre peu après
  const surSaisie = (e) => {
    const champ = e.target.name;
    if (!champ) return;
    if (champ === "titre") fiche.titre = e.target.value;
    else if (champ === "type") fiche.type = e.target.value;
    else if (champ === "notes") fiche.notes = e.target.value;
    else if (champ === "personnages" || champ === "lieux") {
      fiche.champs[champ] = [...e.target.form.querySelectorAll(`input[name="${champ}"]:checked`)].map((c) => c.value);
    } else fiche.champs[champ] = e.target.value;
    if (e.target.tagName === "TEXTAREA") ajusterHauteur(e.target);
    planifierSauvegarde(fiche);
  };

  const form = el("form", { class: "fiche-edition", oninput: surSaisie, onchange: surSaisie, onsubmit: (e) => { e.preventDefault(); terminerEdition(); } },
    el("button", { type: "button", class: "lien-retour", "data-action": "liste" }, "← " + cat.onglet),
    el("p", { class: "etiquette" }, "Modifier : " + cat.nom),
    champTexte("titre", "Nom", fiche.titre, { court: true }),
    el("label", { class: "champ" },
      el("span", { class: "etiquette" }, "Type"),
      el("input", { type: "text", name: "type", value: fiche.type || "", list: idListe, placeholder: cat.exempleType, autocomplete: "off" }),
      el("datalist", { id: idListe }, typesExistants.map((t) => el("option", { value: t }))),
    ),
    cat.champs.map(([cle, libelle]) => champTexte(cle, libelle, fiche.champs[cle], { court: CHAMPS_COURTS.includes(cle), exemple: EXEMPLES[cle] })),
    fiche.categorie === "evenement" ? [
      choixLiens("personnages", "Personnages concernés", [...fichesDe("principal"), ...fichesDe("pnj")], fiche.champs.personnages),
      choixLiens("lieux", "Lieux concernés", fichesDe("lieu"), fiche.champs.lieux),
    ] : null,
    champTexte("notes", "Notes libres", fiche.notes),
    el("div", { class: "fiche-actions" },
      el("button", { type: "submit", class: "bouton bouton-petit" }, "Terminé"),
      el("button", { type: "button", class: "petit-bouton danger", "data-action": "supprimer-fiche", "data-id": fiche.id }, "Supprimer la fiche"),
    ),
    el("p", { class: "discret petit" }, "Enregistrement automatique à chaque modification."),
  );
  // Les zones de texte prennent la hauteur de leur contenu
  requestAnimationFrame(() => form.querySelectorAll("textarea").forEach(ajusterHauteur));
  return form;
}

function champTexte(nom, libelle, valeur, { court = false, exemple = null } = {}) {
  return el("label", { class: "champ" },
    el("span", { class: "etiquette" }, libelle),
    court
      ? el("input", { type: "text", name: nom, value: valeur || "", autocomplete: "off", maxlength: 200, placeholder: exemple })
      : el("textarea", { name: nom, rows: 2, lang: "fr", spellcheck: "true" }, valeur || ""),
  );
}

// Liste de cases à cocher (personnages ou lieux concernés par un événement)
function choixLiens(nom, libelle, fiches, choisis = []) {
  return el("fieldset", { class: "choix-liens" },
    el("legend", { class: "etiquette" }, libelle),
    fiches.length
      ? fiches.map((f) => el("label", { class: "case" },
          el("input", { type: "checkbox", name: nom, value: f.id, checked: choisis.includes(f.id) }),
          el("span", {}, f.titre || "Sans nom"),
        ))
      : el("p", { class: "discret petit" }, "Aucune fiche à relier pour l'instant."),
  );
}

function ajusterHauteur(zone) {
  zone.style.height = "auto";
  zone.style.height = zone.scrollHeight + 2 + "px";
}

// =====================================================================
// Enregistrement
// =====================================================================

function planifierSauvegarde(fiche) {
  fiche.modifie = Date.now();
  ficheModifiee = fiche;
  clearTimeout(minuterie);
  minuterie = setTimeout(sauverFiche, DELAI_SAUVEGARDE);
}

// Renvoie false si l'enregistrement a échoué
export async function sauverFiche() {
  clearTimeout(minuterie);
  const fiche = ficheModifiee;
  if (!fiche) return true;
  ficheModifiee = null;
  if (!trouverFiche(fiche.id)) return true; // supprimée entre-temps
  try {
    await db.ecrire("fiches", { ...fiche, champs: { ...fiche.champs } });
    if (etat.roman && estEpinglee(fiche.id)) afficherEpinglee(); // les fiches épinglées suivent les changements
    annoncer("fiches-changees"); // (nom changé : les fiches repérées dans le texte suivent)
    return true;
  } catch (erreur) {
    ficheModifiee = fiche;
    informer("La fiche n'a pas pu être enregistrée : " + erreur.message, { erreur: true });
    return false;
  }
}

// =====================================================================
// Créer, supprimer, épingler, réordonner
// =====================================================================

// Crée une fiche. Par défaut, elle s'ouvre en modification avec le curseur dans son nom.
// (La recherche Ctrl+K l'utilise avec un nom déjà tapé, sans quitter le texte.)
export async function creerFiche(categorie, { titre = null, edition = true, focus = true } = {}) {
  await sauverFiche();
  const cat = CATEGORIES[categorie];
  const memes = etat.fiches.filter((f) => f.categorie === categorie);
  const fiche = {
    id: nouvelId(), romanId: etat.roman.id, categorie,
    titre: titre || cat.nouveau, type: "", champs: {}, notes: "",
    ordre: memes.length ? Math.max(...memes.map((f) => f.ordre || 0)) + 1 : 0,
    modifie: Date.now(),
  };
  etat.fiches.push(fiche);
  const aEcrire = { fiches: [fiche] };
  // Les deux premiers personnages principaux s'épinglent tout seuls (s'il reste de la place)
  const epinglees = fichesEpinglees().map((f) => f.id);
  if (categorie === "principal" && epinglees.length < MAX_EPINGLEES) {
    noterEpinglees([...epinglees, fiche.id]);
    aEcrire.romans = [etat.roman];
  }
  // Le formulaire s'affiche tout de suite ; l'enregistrement suit (sans faire attendre).
  // Nom proposé par défaut (« Nouveau PNJ ») : il est sélectionné, pour être remplacé en tapant.
  ouvrirFiche(fiche.id, { edition, focus, selection: !titre });
  annoncer("fiches-changees");
  await db.lot({ ecrire: aEcrire });
  return fiche;
}

async function supprimerFiche(id) {
  const fiche = trouverFiche(id);
  if (!fiche) return;
  const ok = await confirmer({
    titre: "Supprimer cette fiche ?",
    message: [`« ${fiche.titre || "Sans nom"} » sera supprimée définitivement.`, "Cette action ne peut pas être annulée."],
    ok: "Supprimer définitivement",
    danger: true,
  });
  if (!ok) return;
  if (ficheModifiee && ficheModifiee.id === id) ficheModifiee = null;
  // On retire aussi cette fiche des événements qui la citaient
  const evenementsModifies = [];
  for (const e of etat.fiches) {
    if (e.categorie !== "evenement" || !e.champs) continue;
    const avant = (e.champs.personnages || []).length + (e.champs.lieux || []).length;
    e.champs.personnages = (e.champs.personnages || []).filter((x) => x !== id);
    e.champs.lieux = (e.champs.lieux || []).filter((x) => x !== id);
    if (e.champs.personnages.length + e.champs.lieux.length !== avant) evenementsModifies.push(e);
  }
  const etaitEpinglee = estEpinglee(id);
  etat.fiches = etat.fiches.filter((f) => f.id !== id);
  annoncer("fiches-changees");
  const aEcrire = { fiches: evenementsModifies };
  if (etaitEpinglee) {
    // Un autre personnage principal (pas encore épinglé, s'il y en a) prend sa place
    const restent = fichesEpinglees().map((f) => f.id);
    const remplacant = fichesDe("principal").find((f) => !restent.includes(f.id));
    noterEpinglees(remplacant ? [...restent, remplacant.id] : restent);
    aEcrire.romans = [etat.roman];
  }
  vue.repliees.delete(id);
  await db.lot({ ecrire: aEcrire, supprimer: { fiches: [id] } });
  informer(`« ${fiche.titre || "Sans nom"} » a été supprimée.`);
  vue.ficheId = null;
  vue.edition = false;
  afficherPanneau();
  garderLeClavier('[data-action="nouvelle"]');
}

// Après une action qui redessine le panneau, le clavier reste dans le panneau
// (sinon il se perdrait sur la page, et Tab repartirait du haut)
function garderLeClavier(...selecteurs) {
  for (const s of selecteurs) {
    const b = $("panneau").querySelector(s);
    if (b && !b.disabled && b.getClientRects().length) { b.focus({ preventScroll: true }); return; }
  }
  const onglet = $("panneau").querySelector('[role="tab"][aria-selected="true"]');
  if (onglet) onglet.focus({ preventScroll: true });
}

// Épingle une fiche, sous celles qui le sont déjà. S'il y en a déjà deux, la plus ancienne laisse sa place.
async function epingler(id) {
  if (!trouverFiche(id)) return;
  sauverFiche();
  const ids = fichesEpinglees().map((f) => f.id).filter((x) => x !== id);
  ids.push(id);
  const retiree = ids.length > MAX_EPINGLEES ? trouverFiche(ids.shift()) : null;
  noterEpinglees(ids);
  vue.repliees.delete(id);
  await apresEpinglage();
  if (retiree) informer(`« ${retiree.titre || "Sans nom"} » n'est plus épinglée : deux fiches au plus restent en haut du panneau.`);
}

async function desepingler(id) {
  sauverFiche();
  noterEpinglees(fichesEpinglees().map((f) => f.id).filter((x) => x !== id));
  vue.repliees.delete(id);
  await apresEpinglage();
}

// L'écran change tout de suite ; l'enregistrement suit
async function apresEpinglage() {
  afficherPanneau();
  garderLeClavier('#contenu-panneau [data-action="epingler"]', '#contenu-panneau [data-action="desepingler"]',
    '#epinglee [data-action="desepingler"]');
  await db.ecrire("romans", etat.roman);
}

async function deplacer(id, sens) {
  if (!await deplacerEvenement(id, sens)) return;
  afficherContenu();
  // Le clavier reste sur la même flèche (ou sur l'autre, si l'événement est arrivé en haut ou en bas)
  const fleche = (a) => `#contenu-panneau [data-action="${a}"][data-id="${CSS.escape(id)}"]`;
  garderLeClavier(fleche(sens < 0 ? "monter" : "descendre"), fleche(sens < 0 ? "descendre" : "monter"));
}
