declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): this;
  }
  interface Dictionary {
    aff: Buffer | string;
    dic: Buffer | string;
  }
  function nspell(dictionary: Dictionary): NSpell;
  export = nspell;
}

declare module 'dictionary-vi' {
  const dictionary: { aff: Buffer; dic: Buffer };
  export default dictionary;
}
