/**
 * Builds the exact-word part of the memory search from a question: significant words only (French and
 * English filler words removed), joined with OR. Names, numbers and rare words are what this catches best.
 */
const STOPWORDS = new Set(
  (
    "les des une est son ses sur par pour pas plus que qui quoi dans avec sans tout tous toute toutes mais donc car " +
    "elle elles ils nous vous leur leurs mes tes nos vos cette ces cet aux ont sont etait etre avoir fait faire peut " +
    "comment quel quelle quels quelles combien quand pourquoi avant apres tres bien aussi alors comme dont entre " +
    "chez notre votre lui moi toi meme encore deja ici voici voila cela ceci ainsi rien autre autres sous selon " +
    "the and for are was were with that this these those from what which when where who why how can could " +
    "would should will shall have has had not but our your their its his her they them you about into than then " +
    "there here some any all each also just only very more most such does did doing been being"
  ).split(" "),
);

export function keywordQuery(text: string, max = 12): string {
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOPWORDS.has(w));
  return Array.from(new Set(words)).slice(0, max).join(" or ");
}
