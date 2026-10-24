// =====================================================================
// LE CORRECTEUR ORTHOGRAPHIQUE : ce que l'application utilise
//
// Ce module est commun à Omni-Texte et Omni-Romancier (dossier correcteur/,
// identique dans les deux dépôts : voir LISEZ-MOI.md). Il s'occupe de :
//   - lancer le travailleur (travailleur.js) qui vérifie en arrière-plan ;
//   - garder le dictionnaire personnel (sur l'appareil seulement) ;
//   - retenir les mots ignorés (jusqu'à la fermeture de l'application) ;
//   - retenir le réglage « correction activée ou non ».
// Il ne dessine rien : le soulignement est fait par chaque application
// (sa zone d'écriture est différente), la bulle de suggestions et la
// liste du dictionnaire personnel sont dans bulle.js et liste.js.
//
// Rien n'est envoyé sur internet : le dictionnaire est un simple fichier
// de l'application, téléchargé une fois puis gardé hors ligne.
// =====================================================================

// Le fichier du dictionnaire (son nom change avec sa version : c'est ce qui
// permet de le garder en réserve tant qu'il ne change pas)
export const DICTIONNAIRE = 'mots-fr-7.5.txt';

// Un mot du texte, comme le voit le moteur (lettres, chiffres, avec
// apostrophes ou traits d'union au milieu)
const MOT = /[\p{L}\p{M}\p{N}]+(?:[-‐‑'’][\p{L}\p{M}\p{N}]+)*/gu;

/** Mot prêt à ranger : forme Unicode unique, apostrophe droite, sans espaces autour. */
export function nettoyerMot(mot) {
  return String(mot ?? '').normalize('NFC').trim().replace(/’/g, "'");
}

/**
 * Crée le correcteur de l'application.
 * @param {object} options
 * @param {{lire: (nom: string, defaut: any) => any, ecrire: (nom: string, valeur: any) => void}} options.stockage
 *   où ranger le réglage et le dictionnaire personnel (propre à chaque application)
 */
export function creerCorrecteur({ stockage }) {
  const personnels = new Set((lireListe(stockage) ?? []).map(nettoyerMot).filter(Boolean));
  const ignores = new Set();
  let noms = new Set();
  let actif = stockage.lire('correcteur', true) !== false;
  let etat = 'arret'; // arret → chargement → pret (ou erreur)
  const ecouteurs = new Set();

  // --- Le travailleur ---
  let travailleur = null; // Worker, ou moteur local de secours
  let numero = 0;
  const enAttente = new Map(); // numéro de la demande → { resoudre, rejeter }

  function signaler(raison) {
    for (const f of ecouteurs) {
      try { f(raison); } catch (erreur) { console.warn('Correcteur :', erreur); }
    }
  }

  function demander(type, donnees = {}) {
    return new Promise((resoudre, rejeter) => {
      const id = ++numero;
      enAttente.set(id, { resoudre, rejeter });
      travailleur.postMessage({ id, type, ...donnees });
    });
  }

  function surReponse({ id, resultat, erreur }) {
    const attente = enAttente.get(id);
    if (!attente) return;
    enAttente.delete(id);
    if (erreur) attente.rejeter(new Error(erreur));
    else attente.resoudre(resultat);
  }

  // Si le navigateur ne sait pas lancer ce travailleur (navigateur ancien),
  // le moteur tourne dans la page elle-même : un peu moins confortable sur
  // un très long texte, mais la correction fonctionne quand même.
  function moteurLocal() {
    let moteur = null;
    let pret = null;
    const actionsLocales = {
      charger: ({ adresse }) => (pret ??= Promise.all([import('./moteur.js'), fetch(adresse)]).then(async ([module, reponse]) => {
        if (!reponse.ok) throw new Error(`dictionnaire introuvable (${reponse.status})`);
        moteur = new module.Moteur(await reponse.text());
      }).catch((erreur) => { pret = null; throw erreur; })),
      accepter: async ({ mots }) => { await pret; moteur.accepter(mots); },
      verifier: async ({ texte }) => { await pret; return moteur.verifier(texte); },
      suggerer: async ({ mot }) => { await pret; return moteur.suggerer(mot); },
    };
    return {
      postMessage({ id, type, ...donnees }) {
        actionsLocales[type](donnees).then(
          (resultat) => surReponse({ id, resultat }),
          (erreur) => surReponse({ id, erreur: String(erreur?.message || erreur) }),
        );
      },
      terminate() {},
    };
  }

  function lancer(local = false) {
    travailleur?.terminate();
    travailleur = null;
    if (!local) {
      try {
        travailleur = new Worker(new URL('./travailleur.js', import.meta.url), { type: 'module' });
        travailleur.addEventListener('message', (e) => surReponse(e.data));
        // Le travailleur n'a pas pu démarrer : on passe au moteur local, et on
        // relance les demandes en cours
        travailleur.addEventListener('error', (e) => {
          if (etat !== 'chargement') return;
          e.preventDefault();
          relancerEnLocal();
        });
      } catch {
        travailleur = null;
      }
    }
    travailleur ??= moteurLocal();
    etat = 'chargement';
    const adresse = new URL(`./${DICTIONNAIRE}`, import.meta.url).href;
    const chargement = demander('charger', { adresse });
    envoyerAcceptes();
    chargement.then(
      () => { if (etat === 'chargement') { etat = 'pret'; signaler('pret'); } },
      (erreur) => {
        if (etat !== 'chargement') return;
        console.warn('Correcteur : dictionnaire indisponible :', erreur);
        etat = 'erreur';
        signaler('erreur');
      },
    );
  }

  function relancerEnLocal() {
    for (const { rejeter } of enAttente.values()) rejeter(new Error('relance'));
    enAttente.clear();
    lancer(true);
    signaler('relance'); // les applications refont leur vérification
  }

  function demarrer() {
    if (etat === 'arret' || etat === 'erreur') lancer();
  }

  function envoyerAcceptes() {
    if (travailleur) demander('accepter', { mots: [...personnels, ...ignores, ...noms] }).catch(() => {});
  }

  function sauver() {
    stockage.ecrire('dictionnaire-personnel', [...personnels]);
  }

  function changementDeMots() {
    envoyerAcceptes();
    signaler('mots');
  }

  return {
    /** La correction est-elle activée ? (réglage de l'appareil) */
    get actif() { return actif; },
    /** 'arret', 'chargement', 'pret' ou 'erreur' (dictionnaire impossible à charger) */
    get etat() { return etat; },

    activer(oui) {
      actif = !!oui;
      stockage.ecrire('correcteur', actif);
      signaler('actif');
    },

    /**
     * Les mots inconnus d'un texte : [{ debut, fin, mot }], positions dans
     * le texte. Liste vide si la correction est désactivée.
     */
    async verifier(texte) {
      if (!actif || !texte) return [];
      demarrer();
      return demander('verifier', { texte });
    },

    /** Jusqu'à 5 corrections pour un mot. */
    async suggerer(mot) {
      demarrer();
      return demander('suggerer', { mot });
    },

    /** Ajoute un mot au dictionnaire personnel. Renvoie false si le mot n'est pas valable. */
    ajouter(mot) {
      mot = nettoyerMot(mot);
      if (!mot || mot.length > 80 || /\s/.test(mot) || !/\p{L}/u.test(mot)) return false;
      personnels.add(mot);
      sauver();
      changementDeMots();
      return true;
    },

    retirer(mot) {
      if (!personnels.delete(nettoyerMot(mot))) return;
      sauver();
      changementDeMots();
    },

    /** Le dictionnaire personnel, dans l'ordre alphabétique */
    mots() {
      return [...personnels].sort((a, b) => a.localeCompare(b, 'fr'));
    },

    /** Ignore un mot jusqu'à la fermeture de l'application. */
    ignorer(mot) {
      mot = nettoyerMot(mot);
      if (!mot || ignores.has(mot)) return;
      ignores.add(mot);
      changementDeMots();
    },

    /**
     * Des noms acceptés en plus (par exemple ceux des fiches d'Omni-Romancier).
     * Chaque mot d'un nom est accepté : « Jean-Kaelith Dumont » fait accepter
     * « Jean-Kaelith », « Jean », « Kaelith » et « Dumont ».
     */
    definirNoms(liste) {
      const nouveaux = new Set();
      for (const nom of liste) {
        for (const mot of String(nom ?? '').match(MOT) ?? []) {
          nouveaux.add(nettoyerMot(mot));
          for (const morceau of mot.split(/[-‐‑'’]/)) if (morceau.length > 1) nouveaux.add(nettoyerMot(morceau));
        }
      }
      if (nouveaux.size === noms.size && [...nouveaux].every((m) => noms.has(m))) return;
      noms = nouveaux;
      changementDeMots();
    },

    /**
     * Prévient quand il faut refaire la vérification : raison = 'mots'
     * (un mot accepté en plus ou en moins), 'actif' (réglage changé), 'pret'
     * (dictionnaire chargé), 'erreur' ou 'relance'. Renvoie de quoi arrêter.
     */
    ecouter(fonction) {
      ecouteurs.add(fonction);
      return () => ecouteurs.delete(fonction);
    },
  };
}

function lireListe(stockage) {
  const liste = stockage.lire('dictionnaire-personnel', []);
  return Array.isArray(liste) ? liste.filter((m) => typeof m === 'string') : [];
}
