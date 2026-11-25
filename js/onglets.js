// =====================================================================
// UNE SEULE PAGE À LA FOIS
// Si Omni-Romancier était ouvert dans deux onglets (ou dans l'application installée
// ET dans le navigateur), chaque page enregistrerait sa propre version du texte
// et effacerait le travail de l'autre, sans prévenir.
// Un « verrou » du navigateur l'empêche : la première page travaille, les
// suivantes attendent avec une explication. Une page en attente prend la main
// dès que l'autre est fermée, à condition d'être affichée à l'écran (ainsi,
// recharger la page active avec F5 ne donne pas la main à un onglet caché).
// Le bouton « Utiliser plutôt cette page » demande à l'autre page de tout
// enregistrer et de céder sa place.
// =====================================================================

const NOM = "atelier-romans";
const canal = "BroadcastChannel" in window ? new BroadcastChannel(NOM) : null;
const DELAI_AVANT_FORCER = 3000;  // l'autre page ne répond pas (endormie) : on prend la main d'office
const INTERVALLE_ESSAIS = 1000;   // une page en attente regarde toutes les secondes si la place est libre
const CLE_CEDE = "omni-romancier-a-cede"; // (sessionStorage) cette page vient de céder sa place : elle attend
const ANCIENNE_CLE_CEDE = "atelier-a-cede";

let demarree = false;
let minuterieEssais = null;

// Lance « demarrer » dès que cette page est la seule active.
// « avantDeCeder » enregistre tout quand une autre page demande la main.
export function demarrerSeul(demarrer, avantDeCeder) {
  if (!navigator.locks) { demarrer(); return; } // navigateur ancien : pas de protection possible

  const lancer = () => {
    if (demarree) return;
    demarree = true;
    clearInterval(minuterieEssais);
    montrerAttente(false);
    demarrer();
  };

  const travailler = async () => {
    if (demarree) return new Promise(() => {});
    // Une autre page demande la main : on enregistre tout, on note qu'on a cédé, puis on se recharge
    if (canal) {
      canal.onmessage = async (e) => {
        if (e.data !== "ceder") return;
        try { await avantDeCeder(); } finally {
          try { sessionStorage.setItem(CLE_CEDE, String(Date.now())); } catch { /* rien */ }
          location.reload();
        }
      };
    }
    lancer();
    return new Promise(() => {}); // garde le verrou jusqu'à la fermeture de la page
  };

  // Verrou perdu (une autre page l'a pris d'office) : on se recharge pour ne plus rien écrire
  const siPerdu = (erreur) => {
    if (erreur && erreur.name === "AbortError") location.reload();
    else lancer(); // problème inattendu avec le verrou : on démarre quand même
  };

  // Essaie de prendre la place si elle est libre (sans faire la queue)
  const essayer = () => {
    if (demarree) return;
    navigator.locks.request(NOM, { ifAvailable: true }, (verrou) => (verrou ? travailler() : null)).catch(siPerdu);
  };

  const attendre = () => {
    montrerAttente(true);
    // On ne prend la place que si cette page est affichée (l'utilisateur la regarde)
    minuterieEssais = setInterval(() => { if (!document.hidden) essayer(); }, INTERVALLE_ESSAIS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) essayer(); });
    const bouton = document.getElementById("bouton-utiliser-ici");
    if (bouton) {
      bouton.onclick = () => {
        bouton.disabled = true;
        if (canal) canal.postMessage("ceder");
        // On guette la place libérée, puis on la prend d'office si l'autre page ne répond pas
        const debut = Date.now();
        const guetter = setInterval(() => {
          if (demarree) { clearInterval(guetter); return; }
          if (Date.now() - debut < (canal ? DELAI_AVANT_FORCER : 0)) { essayer(); return; }
          clearInterval(guetter);
          navigator.locks.request(NOM, { steal: true }, travailler).catch(siPerdu);
        }, 150);
      };
    }
  };

  // Cette page vient de céder sa place à une autre : elle attend, sans la lui reprendre
  let aCede = false;
  try {
    const brut = sessionStorage.getItem(CLE_CEDE) ?? sessionStorage.getItem(ANCIENNE_CLE_CEDE);
    aCede = Date.now() - Number(brut || 0) < 10000;
    sessionStorage.removeItem(CLE_CEDE);
    sessionStorage.removeItem(ANCIENNE_CLE_CEDE);
  } catch { /* rien */ }
  if (aCede) { attendre(); return; }

  navigator.locks.request(NOM, { ifAvailable: true }, (verrou) => {
    if (verrou) return travailler();
    attendre();
    return null;
  }).catch(siPerdu);
}

// Affiche (ou cache) l'explication « déjà ouvert ailleurs », à la place de l'application
function montrerAttente(oui) {
  const alerte = document.getElementById("alerte-onglet");
  const principal = document.querySelector("main");
  const entete = document.querySelector("header.entete");
  if (alerte) alerte.hidden = !oui;
  if (principal) principal.hidden = oui;
  if (entete) entete.inert = oui;
}
