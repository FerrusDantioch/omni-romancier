// =====================================================================
// FENÊTRES DE DIALOGUE ET PETITS MESSAGES
// On utilise la balise <dialog> du navigateur : la touche Échap la ferme,
// et le clavier reste « piégé » dedans tant qu'elle est ouverte.
// =====================================================================

import { el } from "./outils.js";

// Ouvre une fenêtre et attend la réponse.
// - titre   : le titre de la fenêtre
// - corps   : le contenu (texte ou éléments HTML)
// - ok      : texte du bouton de validation
// - danger  : true pour un bouton rouge (suppression…)
// - lireFormulaire : si présent, appelé à la validation ; renvoie la valeur
//   du formulaire, ou une chaîne d'erreur pour bloquer la validation.
// - autres  : boutons supplémentaires [{ texte, valeur, danger }] ; un clic renvoie leur « valeur »
// Renvoie la valeur obtenue, ou null si l'on a annulé.
export function ouvrirDialogue({ titre, corps, ok = "Valider", annuler = "Annuler", danger = false, lireFormulaire = null, autres = [] }) {
  return new Promise((repondre) => {
    const zoneErreur = el("p", { class: "dialogue-erreur", role: "alert" });
    const form = el("form", { method: "dialog", class: "dialogue-form", novalidate: true },
      el("h2", { class: "dialogue-titre" }, titre),
      el("div", { class: "dialogue-corps" }, corps),
      zoneErreur,
      el("div", { class: "dialogue-boutons" },
        el("button", { type: "button", class: "petit-bouton", value: "annuler", onclick: () => fermer(null) }, annuler),
        autres.map((b) => el("button", { type: "button", class: "petit-bouton" + (b.danger ? " danger" : ""), value: b.valeur, onclick: () => fermer(b.valeur) }, b.texte)),
        el("button", { type: "submit", class: danger ? "bouton bouton-danger" : "bouton", value: "ok" }, ok),
      ),
    );
    const dialogue = el("dialog", { class: "dialogue", "aria-label": titre }, form);

    let reponse = null;
    function fermer(valeur) {
      reponse = valeur;
      dialogue.close();
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (lireFormulaire) {
        const valeur = lireFormulaire(form);
        if (typeof valeur === "string") { zoneErreur.textContent = valeur; return; } // erreur à corriger
        fermer(valeur);
      } else {
        fermer(true);
      }
    });
    const declencheur = document.activeElement;
    // Échap ou fermeture : on rend la réponse, on retire la fenêtre et on restaure le focus
    dialogue.addEventListener("close", () => {
      dialogue.remove();
      if (declencheur && declencheur.isConnected && typeof declencheur.focus === "function") {
        declencheur.focus({ preventScroll: true });
      }
      repondre(reponse);
    });

    document.body.append(dialogue);
    dialogue.showModal();
    // Place le curseur dans le premier champ (ou sur le bouton Annuler pour une suppression)
    const premier = danger
      ? form.querySelector('button[value="annuler"]')
      : form.querySelector("input, select, textarea") || form.querySelector('button[type="submit"]');
    if (premier) premier.focus();
    if (premier && premier.select && premier.type === "text") premier.select();
  });
}

// Demande une confirmation simple. Renvoie true (oui) ou false (non).
export async function confirmer({ titre, message, ok = "Confirmer", danger = false }) {
  const corps = Array.isArray(message) ? message.map((m) => el("p", {}, m)) : el("p", {}, message);
  return (await ouvrirDialogue({ titre, corps, ok, danger })) === true;
}

// Affiche un petit message en bas de l'écran, qui disparaît tout seul.
// (Si l'on est en train d'écrire, un message qui s'en va est seulement caché, et retiré plus tard :
// retirer quelque chose de la page pendant la frappe couperait l'annulation Ctrl+Z, voir outils.js.)
export function informer(message, { duree = 4000, erreur = false } = {}) {
  let zone = document.getElementById("notifications");
  if (!zone) {
    // Chaque bulle porte déjà role="status" ou role="alert" (évite une double live-region)
    zone = el("div", { id: "notifications" });
    document.body.append(zone);
  }
  const enEcriture = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type === "text"));
  };
  const retirer = (b) => { if (enEcriture()) b.hidden = true; else b.remove(); };
  if (!enEcriture()) for (const b of zone.querySelectorAll(".notification[hidden]")) b.remove(); // (le ménage en attente)
  const bulle = el("div", { class: erreur ? "notification erreur" : "notification", role: erreur ? "alert" : "status" }, message);
  zone.append(bulle);
  // Pas plus de deux messages à la fois : les plus anciens s'en vont
  const visibles = [...zone.children].filter((b) => !b.hidden);
  for (const b of visibles.slice(0, -2)) retirer(b);
  setTimeout(() => retirer(bulle), erreur ? duree * 2 : duree);
}
