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
        durationIn: 2.2,
        durationOut: 2.7
    }
};
