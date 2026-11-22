/** Apache-2.0. The main entry: importing it registers <liquid-glass> (once, and only in a browser).
 * Import 'liquidglass/element' instead to register under another name or not at all. */
import {define} from './element.mjs';

export {LiquidGlassElement, define, configureCanvasKit} from './element.mjs';
define();
