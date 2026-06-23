export { middleware } from 'nextra/locales'

export const config = {
  // Run on every path except API, Next internals, pagefind and files with an
  // extension — so the locale prefix is applied to doc routes only.
  matcher: ['/((?!api|_next/static|_next/image|_pagefind|favicon.ico|.*\\..*).*)'],
}
