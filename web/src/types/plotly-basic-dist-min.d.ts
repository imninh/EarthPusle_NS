// The basic dist bundle ships no TypeScript declarations. Its API matches the
// full plotly.js dist for the trace types we use (scatter/line/markers).
declare module 'plotly.js-basic-dist-min' {
  const Plotly: typeof import('plotly.js-dist-min').default
  export default Plotly
}
