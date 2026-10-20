/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#102238',
    tint: '#1186D9',

    background: '#F3F8FC',
    foreground: '#102238',

    card: '#FFFFFF',
    cardForeground: '#102238',

    primary: '#1186D9',
    primaryForeground: '#ffffff',

    secondary: '#E5F2FB',
    secondaryForeground: '#174366',

    muted: '#E8F0F6',
    mutedForeground: '#607A90',

    accent: '#DDF4F1',
    accentForeground: '#126C68',

    destructive: '#D84B5B',
    destructiveForeground: '#ffffff',

    border: '#D8E5EE',
    input: '#D8E5EE',
    success: '#138B78',
    warning: '#C97918',
    inverse: '#FFFFFF',
  },

  dark: {
    text: '#F5FAFF',
    tint: '#45C8FF',
    background: '#071522',
    foreground: '#F5FAFF',
    card: '#102438',
    cardForeground: '#F5FAFF',
    primary: '#45C8FF',
    primaryForeground: '#062033',
    secondary: '#17344B',
    secondaryForeground: '#D7EFFA',
    muted: '#112B40',
    mutedForeground: '#91ADBF',
    accent: '#123E47',
    accentForeground: '#8DE7DC',
    destructive: '#FF7B86',
    destructiveForeground: '#250A10',
    border: '#24455D',
    input: '#2A506A',
    success: '#64D6BD',
    warning: '#F4B760',
    inverse: '#071522',
  },

  radius: 8,
};

export default colors;
