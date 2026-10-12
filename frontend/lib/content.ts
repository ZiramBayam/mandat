/**
 * Every word and every label on this page lives here.
 *
 * The layout, the motion and the CSS came from a credited third-party agency
 * site (see README). None of its copy came with it, and none is wanted: that
 * site sells campaigns, this one demonstrates a permission system. So the text
 * is ours, written for people reading about an envelope that a contract
 * enforces, rather than about reach.
 *
 * Values that are chain state are not in this file. Those are read at runtime
 * from Monad and passed in as props, so the page can never assert something the
 * chain does not say (working/constraints.md R6). What is here is copy and the
 * few constants that are genuinely fixed -- contract addresses and tx hashes
 * that will not change between builds.
 */

export const COMMIT_STATES = [
    { key: 'proposed', label: 'Proposed', blurb: 'A delegation was made. Nothing is enforced yet.' },
    { key: 'voted', label: 'Voted', blurb: 'The owner signed the intent. Still nothing enforced.' },
    { key: 'finalized', label: 'Finalized', blurb: 'The root ratified it. The envelope is now real.' },
    { key: 'verified', label: 'Verified', blurb: 'The chain agrees. This is what the agent may act on.' },
] as const;

/**
 * Scene 1 -- the envelope.
 *
 * The four cards stand in for the four commit states rather than for four
 * photographs. A stock photo of an office would say nothing; the state machine
 * is the thing being demonstrated.
 */
export const AUTHORITY = {
    title: ['a permission you', 'can actually see.'],
    subtitle: 'capped, revocable, enforced on chain.',
    labels: [
        'the agent holds a permission, not a key',
        'the cap is not the balance',
        'mined, and reverted',
    ],
    closing:
        'An agent that holds an envelope can be told what it may spend, for how ' +
        'long, and by whom it can be stopped. It cannot be talked into spending ' +
        'more, because the rule is not a sentence in a prompt.',
} as const;

/**
 * Scene 2 -- enforcement.
 *
 * Four cards, each one a claim the contracts make and the chain has already
 * been asked to confirm. Every one of these is backed by a transaction on
 * Monad testnet; the hashes are in EVIDENCE below.
 */
export const ENFORCEMENT = {
    title: 'what the contract',
    titleAccent: 'actually enforces:',
    cards: [
        {
            color: 'green',
            sticker: 'hand',
            title: 'Spend',
            items: [
                '0.5 WMON per rolling 24h period',
                'Charged against the delegator, not the agent',
                'Two tiers priced by the manifest',
            ],
        },
        {
            color: 'lightblue',
            sticker: 'camera',
            title: 'Target',
            items: [
                'Only the seller address is reachable',
                'Arbitrary calldata is rejected before execution',
                'Method allowlist is per-envelope',
            ],
        },
        {
            color: 'orange',
            sticker: 'smiley',
            title: 'Time',
            items: [
                'Every caveat carries its own expiry',
                'An expired envelope is invalid, not advisory',
                'releaseAt is read from the terms, not assumed',
            ],
        },
        {
            color: 'pink',
            sticker: 'heart',
            title: 'Revocation',
            items: [
                'Revoking a parent kills the whole subtree',
                'Already-minted children are revoked too',
                'Visible in the explorer as a proof, not a claim',
            ],
        },
    ],
} as const;

/**
 * Scene 3 -- the agent.
 *
 * The marquee columns list the actual packages in this repository. Using real
 * names instead of client logos keeps the section honest about what it is.
 */
export const AGENT = {
    title: ['the agent reads', 'its own ceiling'],
    subtitle: 'and then stops.',
    marqueeLabel: 'built from:',
    columns: [
        [
            { name: '@mandat/protocol', tone: 'green' },
            { name: '@mandat/envelope-cli', tone: 'lightblue' },
            { name: '@mandat/three-light', tone: 'orange' },
        ],
        [
            { name: '@mandat/authority-header', tone: 'pink' },
            { name: 'AuthorityRegistry', tone: 'maroon' },
            { name: 'SkillAuthorityEnforcer', tone: 'darkblue' },
        ],
    ],
    closing:
        'The model is asked what it may spend and answers in its own words. ' +
        'The part that matters is not the answer -- it is that the answer was ' +
        'never allowed to decide. The envelope was already on chain before the ' +
        'model was asked.',
} as const;

/**
 * Scene 4 -- finality.
 *
 * The scrolling words are the four commit states, because that sequence is the
 * spine of the whole system: nothing an agent acts on skips a step in it.
 */
export const FINALITY = {
    words: ['PROPOSED', 'VOTED', 'FINALIZED', 'VERIFIED'],
    title: 'nothing is enforced',
    titleAccent: 'until the chain says so.',
    lampsLabel: 'live commit states',
    lampsBlurb:
        'Read from a Monad websocket. Each state carries a distinct marker ' +
        'shape as well as a colour, so the sequence survives greyscale.',
    footerNote:
        'Built for the Monad ecosystem. Contracts on testnet; nothing here is ' +
        'audited and nothing here holds real value.',
} as const;

/**
 * Evidence.
 *
 * These are recorded facts about transactions that already happened, so they
 * are constants rather than runtime reads. They are shown with links so a
 * reader can check any claim on this page without trusting the page.
 */
export const EVIDENCE = {
    g6Within: {
        label: 'Within cap',
        value: '0x477436f2…530d357',
        href: 'https://testnet.monadvision.com/tx/0x477436f21f2162cb9db4ef15ab78565a89b6abaf979062370249c29cf530d357',
        outcome: 'success',
    },
    g6Over: {
        label: 'Over cap',
        value: '0x870080de…cd275ee',
        href: 'https://testnet.monadvision.com/tx/0x870080debbd23926d336fc6c338553f0e0a95f233d74e8b8d149b2b05cd275ee',
        outcome: 'reverted',
    },
    registry: '0xb51807EC9C8090c155E80B085ebdD999CCf68D30',
    enforcer: '0x5c6EE4586ACABcb6326069c229E58091B21ef384',
    root: '0xDf9E68Bee379A298709aeb94072d1b1b9A333921',
} as const;

export const FOOTER_LINKS = [
    { label: 'Monad explorer', href: 'https://testnet.monadvision.com' },
    { label: 'Contracts', href: `https://testnet.monadvision.com/address/${EVIDENCE.registry}` },
    { label: 'Source', href: 'https://github.com/ZiramBayam/mandat' },
] as const;