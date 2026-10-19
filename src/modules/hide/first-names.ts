/**
 * Common French and English first names, used to recognise person names locally (no external
 * service). Names that are also frequent places or words were left out (Paris, Nancy, Florence,
 * Victoria, Jordan, Noël…). Accents are ignored when comparing.
 */
const FRENCH = `
marie jeanne francoise monique catherine nathalie isabelle sylvie anne martine christine sophie nicole valerie sandrine
stephanie veronique celine chantal patricia brigitte laurence julie aurelie emilie camille caroline virginie elodie
laetitia audrey melanie delphine helene pauline claire corinne dominique agnes michele christiane josiane danielle
jacqueline simone denise odette yvette ginette germaine suzanne madeleine marguerite lucie lea manon chloe emma ines
jade louise alice lina rose anna mila ambre julia mia lena juliette zoe lola romane sarah clara eva margaux charlotte
mathilde anais marine laura oceane justine morgane marion elsa agathe victoire apolline capucine heloise clemence
constance margot noemie amandine coralie estelle fanny gaelle karine laure magali muriel nadine nadia fatima leila
yasmine samia amina myriam sonia beatrice bernadette colette eliane evelyne ghislaine huguette annie joelle josette
liliane lucienne marcelle mireille paulette renee solange therese yvonne gisele arlette sabine severine vanessa
jessica cindy alexandra clementine lou nina leonie adele iris eleonore gabrielle berenice hortense garance salome
maelle maeva lilou elise albane diane judith ophelie perrine sandra sylviane tiphaine valentine axelle aude benedicte
claudine cecile edith emmanuelle fabienne genevieve gwenaelle ingrid irene jocelyne lydie marielle maryse nelly noelle
odile pascale raymonde regine rolande roseline viviane yolande
jean pierre michel andre philippe rene louis alain jacques bernard marcel daniel roger robert paul claude christian
henri georges nicolas francois patrick gerard christophe joseph julien maurice raymond david pascal frederic laurent
stephane eric thierry olivier sebastien thomas vincent jerome franck guillaume antoine alexandre maxime romain mathieu
matthieu hugo lucas leo gabriel raphael arthur jules adam nathan ethan noah liam sacha gabin timeo theo tom enzo
baptiste benjamin clement quentin kevin jonathan anthony florian adrien aurelien damien fabien gregory ludovic mickael
michael cedric arnaud benoit bruno didier emmanuel fabrice gilles herve lionel marc martin mathis patrice regis serge
sylvain thibault xavier yann yannick yves albert armand auguste bastien charles corentin cyril denis dylan edouard
emile etienne felix fernand florent francis gael gaetan gaston germain guy gustave hector hubert jacky joel kylian leon
loic lucien marius mael mehdi mohamed karim rachid youssef samir nabil malik hamid omar ali ahmed nordine morgan
nathanael noam pablo remi remy simon stanislas tristan valentin victor vivien william yanis zacharie augustin achille
alphonse basile bertrand elie eliott evan gauthier jeremy jeremie josselin loris mateo matheo nolan octave paulin
philibert raoul roland sylvestre theodore thibaut ulysse urbain wilfried
`;

const ENGLISH = `
mary jennifer linda elizabeth barbara susan karen lisa betty margaret ashley kimberly emily donna michelle carol amanda
dorothy melissa deborah rebecca sharon cynthia kathleen amy angela shirley brenda pamela helen samantha katherine
debra rachel carolyn janet maria heather ruth olivia joyce kelly lauren christina joan megan andrea cheryl hannah
martha gloria teresa ann frances kathryn janice abigail judy sophia grace amber doris marilyn beverly isabella theresa
natalie brittany kayla alexis lori ava harper ella lily ellie ruby freya poppy isla amelia holly molly katie bethany
eleanor imogen phoebe scarlett abby fiona gemma joanne kirsty lindsay nicola siobhan tracey wendy hope faith joy june
may april
james john richard christopher matthew mark donald steven andrew joshua kenneth brian george timothy ronald edward
jason jeffrey ryan jacob gary nicholas stephen larry justin scott brandon samuel alexander frank jack dennis jerry tyler
aaron jose henry douglas zachary peter kyle walter jeremy keith terry gerald harold sean carl lawrence jesse bryan billy
joe bruce logan willie alan juan wayne elijah randy roy ralph eugene russell bobby mason philip oliver harry charlie
oscar archie alfie freddie arlo finley owen callum connor declan graham ian neil nigel stuart colin craig darren gareth
gavin kieran matt mike steve tim ben sam dan chris nick rob bill will bob jim tony ted max alex josh luke jake
`;

export const FIRST_NAMES: ReadonlySet<string> = new Set(`${FRENCH} ${ENGLISH}`.split(/\s+/).filter(Boolean));

/** Also ordinary words: alone, they count as a name only in the middle of a sentence. */
export const AMBIGUOUS_FIRST_NAMES: ReadonlySet<string> = new Set([
  "will", "may", "june", "april", "hope", "faith", "joy", "grace", "mark", "bill", "frank", "rose", "claire", "marine",
  "max", "guy", "victoire", "constance", "ambre", "lou",
]);
