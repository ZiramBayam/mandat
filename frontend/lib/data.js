// ─── lib/data.js ────────────────────────────────────────────────────────────
// Animation configuration only.
//
// The brand data this file used to hold -- the Truus marquee logos, the agency
// card copy, the social links, the "call us" service cards -- is gone. None of it
// belonged to Mandat, and keeping it would have meant shipping someone else's
// clients in our bundle.
//
// What is left is the tuning that drives motion, because that is behaviour rather
// than content, and the components read it from one place so a value can be
// changed without hunting through a component tree.
//
// Anything that represents on-chain state is NOT here. It is read from Monad at
// runtime, per working/constraints.md R6: this UI holds no state of its own.

export const WIGGLE_CONFIG = {
    logoMandat: 4,
    socials: 5,
    jobHeading: 1,
    googleMap: 1,
    email: 1,
    whatsapp: 1,
};

// ─── Animation Configurations ─────────────────────────────────────────────
export const ANIMATION_CONFIG = {
    transitionScribble: {
        strokeWidthStart: "8%",
        strokeWidthMax: "31%",
        scale: 0.7,
        // Writing and erasing the word, then the HOLD between them and the RECEDE
        // of the veil, are in TransitionScribble.jsx. The arrival runs
        // 0.6s waiting for the face + durationIn + HOLD + durationOut + RECEDE,
        // which is 4.3s at these values. At the previous 2.2 and 2.7 it was
        // 6.8s, and every one of those seconds had a blank screen over it.
        durationIn: 1.4,
        durationOut: 1.0
    }
};
