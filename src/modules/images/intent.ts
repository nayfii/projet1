/**
 * Images in the chat: does this message ask for an image? Like ChatGPT, a plain request is enough
 * ("crée une image de…", "dessine…", "ajoute un chapeau sur la photo"); the "Image" button in the
 * input forces it. Questions about images ("comment créer une image dans Canva ?") stay questions.
 */

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const NOUNS = "(?:image|images|illustration|dessin|logo|photo|visuel|affiche|icone|picture|pictures|drawing|poster|icon|artwork|portrait|wallpaper|fond d'ecran|banniere|banner|mockup|maquette visuelle)";
const CREATE_FR = "(?:genere|generes|generez|cree|crees|creez|creer|dessine|dessines|dessinez|fais|faites|fais-moi|fait moi|produis|produisez|imagine|imaginez|illustre|realise|realisez|concois|concevez|peux-tu (?:me )?(?:creer|generer|dessiner|faire)|tu peux (?:me )?(?:creer|generer|dessiner|faire))";
const CREATE_EN = "(?:generate|create|draw|make|design|render|paint|sketch|can you (?:create|generate|draw|make|design))";
const CREATE = new RegExp(`\\b(?:${CREATE_FR}|${CREATE_EN})\\b[^.?!\\n]{0,60}\\b${NOUNS}\\b`);
const DRAW_ALONE = /^\s*(?:dessine|dessinez|draw|sketch|paint)\b/;
const EDIT = /\b(?:ajoute|ajoutez|ajouter|enleve|enlevez|retire|retirez|supprime|supprimez|remplace|remplacez|change|changez|modifie|modifiez|retouche|retouchez|transforme|transformez|mets|mettez|rends|rendez|colorie|recadre|floute|add|remove|replace|change|edit|turn|make it|put|erase|recolor|crop|blur)\b/;
const HOW_TO = /\b(?:comment|pourquoi|explique|expliquer|how (?:to|do|can i)|why|explain|quel outil|which tool|tutoriel|tutorial)\b/;

export type ImageIntent = "generate" | "edit";

/**
 * `hasImage`: the message carries an image, or the conversation's last answer was an image (an
 * edit then applies to it, like "now make it blue").
 */
export function imageIntent(text: string, options: { hasImage: boolean; forced?: boolean }): ImageIntent | null {
  const t = fold(text).trim();
  if (!t) return null;
  if (options.forced) return options.hasImage && EDIT.test(t) ? "edit" : "generate";
  if (HOW_TO.test(t)) return null;
  if (options.hasImage && EDIT.test(t) && t.length <= 400) return "edit";
  if (CREATE.test(t) || DRAW_ALONE.test(t)) return "generate";
  return null;
}
