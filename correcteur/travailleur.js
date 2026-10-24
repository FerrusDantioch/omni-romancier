// =====================================================================
// LE TRAVAILLEUR DU CORRECTEUR (Web Worker)
//
// Un « Web Worker » est un petit programme qui tourne à côté de la page,
// en arrière-plan : même sur un très long chapitre, la vérification ne
// fige jamais l'écriture. La page lui envoie des messages (« vérifie ce
// texte », « propose des corrections pour ce mot »), il répond par un
// message, dans l'ordre des demandes.
//
// Chaque message reçu : { id, type, … } ; chaque réponse : { id, resultat }
// ou { id, erreur }.
// =====================================================================

import { Moteur } from './moteur.js';

let moteur = null;
let chargement = null;

async function charger(adresse) {
  const reponse = await fetch(adresse);
  if (!reponse.ok) throw new Error(`dictionnaire introuvable (${reponse.status})`);
  moteur = new Moteur(await reponse.text());
  // L'index des suggestions est préparé un peu plus tard, au calme : la
  // première suggestion sera ainsi immédiate.
  setTimeout(() => moteur.indexReplie(), 1500);
  return moteur.mots.size;
}

const actions = {
  // (en cas d'échec, une nouvelle demande pourra réessayer)
  charger: ({ adresse }) => (chargement ??= charger(adresse).catch((erreur) => { chargement = null; throw erreur; })),
  accepter: async ({ mots }) => { await chargement; moteur.accepter(mots); },
  verifier: async ({ texte }) => { await chargement; return moteur.verifier(texte); },
  suggerer: async ({ mot }) => { await chargement; return moteur.suggerer(mot); },
};

self.addEventListener('message', async (e) => {
  const { id, type } = e.data;
  try {
    const resultat = await actions[type](e.data);
    self.postMessage({ id, resultat });
  } catch (erreur) {
    self.postMessage({ id, erreur: String(erreur?.message || erreur) });
  }
});
