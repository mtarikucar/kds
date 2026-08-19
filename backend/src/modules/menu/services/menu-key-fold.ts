/**
 * Fold a category or product name into a comparison key.
 *
 * Turkish is this product's primary locale and it is exactly where the
 * default fold breaks: "İÇECEKLER".toLowerCase() yields "i̇çecekler" — an
 * ASCII i followed by a combining dot above — which never equals the
 * "içecekler" a lowercase heading produces. A menu written in caps would
 * then create a second category instead of merging into the first.
 */
export function foldMenuKey(value: string): string {
  return (value ?? "").trim().toLocaleLowerCase("tr-TR");
}
