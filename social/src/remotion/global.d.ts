/**
 * Ambient module declaration for the one non-TS asset the Remotion bundle
 * imports for its side effect — `fonts.generated.css` (F17, see
 * `register-fonts.ts`). Webpack's default `.css` rule (`style-loader` +
 * `css-loader`) handles the actual bundling; this declaration only tells
 * `tsc --noEmit` (which never runs webpack) that the specifier is valid and
 * has no exports worth typing.
 */
declare module '*.css';
