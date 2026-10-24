// =====================================================================
// LA BULLE DE SUGGESTIONS
//
// Elle apparaît quand on touche (ou clique) un mot souligné : jusqu'à 5
// corrections, puis « Ajouter au dictionnaire » et « Ignorer ».
// Toucher la bulle ne retire pas le curseur du texte : sur téléphone, le
// clavier reste ouvert. Échap, ou toucher ailleurs, la referme.
// Son apparence est réglée dans correcteur.css (couleurs fournies par
// chaque application).
// =====================================================================

let bulle = null;
let ouverte = null; // { surFermeture } de la bulle affichée
let placement = null; // () => DOMRect du mot (pour se replacer)

function creer() {
  bulle = document.createElement('div');
  bulle.className = 'correcteur-bulle';
  bulle.setAttribute('role', 'group');
  bulle.hidden = true;
  // Toucher la bulle ne déplace pas le curseur (ni le focus) hors du texte
  bulle.addEventListener('pointerdown', (e) => e.preventDefault());
  bulle.addEventListener('mousedown', (e) => e.preventDefault());
  document.body.append(bulle);
  // Toucher ailleurs ferme la bulle (le texte, lui, peut rouvrir une bulle)
  document.addEventListener('pointerdown', (e) => {
    if (ouverte && !bulle.contains(e.target)) fermerBulle();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (ouverte && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      fermerBulle();
    }
  }, true);
  window.addEventListener('resize', () => ouverte && placer());
  window.visualViewport?.addEventListener('resize', () => ouverte && placer());
}

function bouton(classe, texte, action, titre = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = classe;
  b.textContent = texte;
  if (titre) b.title = titre;
  b.addEventListener('click', () => {
    fermerBulle();
    action();
  });
  return b;
}

/**
 * Ouvre la bulle sous un mot.
 * @param {object} options
 * @param {() => DOMRect | null} options.position  la place du mot à l'écran (null : mot plus visible)
 * @param {string} options.mot  le mot souligné
 * @param {Promise<string[]>} options.suggestions
 * @param {(correction: string) => void} options.remplacer
 * @param {() => void} options.ajouter  ajouter au dictionnaire personnel
 * @param {() => void} options.ignorer
 * @param {() => void} [options.surFermeture]
 */
export function ouvrirBulle({ position, mot, suggestions, remplacer, ajouter, ignorer, surFermeture = () => {} }) {
  if (!bulle) creer();
  fermerBulle();
  ouverte = { surFermeture };
  placement = position;
  bulle.setAttribute('aria-label', `Corriger « ${mot} »`);

  const liste = document.createElement('div');
  liste.className = 'correcteur-suggestions';
  liste.setAttribute('aria-live', 'polite');
  const attente = document.createElement('p');
  attente.className = 'correcteur-message';
  attente.textContent = 'Recherche de corrections…';
  liste.append(attente);

  const actions = document.createElement('div');
  actions.className = 'correcteur-actions';
  actions.append(
    bouton('correcteur-action', 'Ajouter au dictionnaire', ajouter, 'Ce mot ne sera plus jamais souligné sur cet appareil'),
    bouton('correcteur-action', 'Ignorer', ignorer, "Ne plus souligner ce mot jusqu'à la fermeture de l'application"),
  );
  bulle.replaceChildren(liste, actions);
  bulle.hidden = false;
  placer();

  const cetteBulle = ouverte;
  suggestions.then(
    (propositions) => {
      if (ouverte !== cetteBulle) return;
      if (!propositions.length) {
        attente.textContent = 'Aucune correction trouvée';
      } else {
        liste.replaceChildren(...propositions.map((p) => {
          const b = bouton('correcteur-suggestion', p, () => remplacer(p), `Remplacer par « ${p} »`);
          b.lang = 'fr';
          return b;
        }));
      }
      placer();
    },
    () => {
      if (ouverte === cetteBulle) attente.textContent = 'Corrections indisponibles pour le moment';
    },
  );
}

export function fermerBulle() {
  if (!ouverte) return;
  const { surFermeture } = ouverte;
  ouverte = null;
  placement = null;
  bulle.hidden = true;
  bulle.replaceChildren();
  surFermeture();
}

export function bulleOuverte() {
  return !!ouverte;
}

/** Replace la bulle sous son mot (après un défilement, par exemple). */
export function replacerBulle() {
  if (ouverte) placer();
}

// La bulle se place juste sous le mot, ou au-dessus s'il n'y a pas la place
// (en tenant compte du clavier du téléphone, qui cache le bas de l'écran).
function placer() {
  const r = placement?.();
  if (!r) { fermerBulle(); return; }
  const vue = window.visualViewport;
  const hautVisible = vue ? vue.offsetTop : 0;
  const basVisible = vue ? vue.offsetTop + vue.height : window.innerHeight;
  const largeurVisible = vue ? vue.width : document.documentElement.clientWidth;
  if (r.bottom < hautVisible || r.top > basVisible) { fermerBulle(); return; }
  const largeur = bulle.offsetWidth, hauteur = bulle.offsetHeight;
  let haut = r.bottom + 6;
  if (haut + hauteur > basVisible - 8 && r.top - hauteur - 6 > hautVisible + 8) haut = r.top - hauteur - 6;
  const gauche = Math.max(8, Math.min(r.left, largeurVisible - largeur - 8));
  bulle.style.top = `${Math.round(haut)}px`;
  bulle.style.left = `${Math.round(gauche)}px`;
}
