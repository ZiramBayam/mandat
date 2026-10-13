/**
 * Every word on this page lives here.
 *
 * The layout, the motion and the CSS came from a credited third-party agency
 * site (see README). None of its copy came with it, and none is wanted: that
 * site sells campaigns, this one is about giving an AI a wallet it cannot empty.
 *
 * The words are written for someone who does not already know what a caveat
 * emitter is. Technical terms appear -- they have to, this is the subject --
 * but each one is explained the first time it turns up, and the card copy in
 * particular is plain speech. An earlier pass wrote "0.5 WMON per rolling 24h
 * period" on a card, which is accurate and unreadable; it is now "it can spend up
 * to half a MON a day".
 *
 * Values that are chain state are not in this file. Those are read at runtime
 * from Monad and passed in as props, so the page can never assert something the
 * chain does not say (working/constraints.md R6). What is here is copy, plus the
 * few constants that genuinely will not change between builds.
 */

export const COMMIT_STATES = [
    {
        key: 'proposed',
        label: 'Asked for',
        blurb: 'Someone asked the agent for permission to spend. Nothing is allowed yet.',
    },
    {
        key: 'voted',
        label: 'Owner agreed',
        blurb: 'The wallet in charge signed off on the request. Still nothing allowed yet.',
    },
    {
        key: 'finalized',
        label: 'Made real',
        blurb: 'The top-level wallet put its name to it. The permission now exists.',
    },
    {
        key: 'verified',
        label: 'Confirmed',
        blurb: 'The blockchain agrees it is real. This is what the agent may act on.',
    },
] as const;

/**
 * Scene 1 -- the permission itself.
 */
export const AUTHORITY = {
    title: ['a permission', 'you can see.'],
    subtitle: 'capped, revocable, and checked by a contract.',
    labels: ['it gets an allowance, not a key', 'the limit is not the money', 'the owner can pull it back'],
    closing:
        'An agent is usually handed a wallet and trusted with it. This hands it ' +
        'an allowance instead — how much, how often, until when, and who can ' +
        'take it back.',
} as const;

/**
 * Scene 2 -- what the contract actually refuses to do.
 *
 * Four cards, four refusals, each one already demonstrated by a transaction on
 * Monad testnet. Every claim on this page can be checked against the chain by
 * clicking it, which is the point: a demo page that cannot be verified is just
 * decoration.
 */
export const ENFORCEMENT = {
    title: 'what the contract',
    titleAccent: 'refuses:',
    cards: [
        {
            color: 'green',
            sticker: 'hand',
            title: 'Too much',
            items: [
                'It can spend up to half a MON a day',
                'The money comes out of your wallet, not the agent’s',
                'Two price levels, and you pick which one',
            ],
        },
        {
            color: 'darkblue',
            sticker: 'camera',
            title: 'The wrong place',
            items: [
                'It can only talk to the shop you chose',
                'Any other address is turned away',
                'Only the payment methods you allow',
            ],
        },
        {
            color: 'orange',
            sticker: 'smiley',
            title: 'Too late',
            items: [
                'Every permission carries an expiry date',
                'Once it passes, it is invalid, not discouraged',
                'The date is read from the rules, not assumed',
            ],
        },
        {
            color: 'maroon',
            sticker: 'heart',
            title: 'Your call',
            items: [
                'Say stop, and everything stops',
                'Pulling the top permission pulls the ones under it',
                'You can see the proof yourself in the explorer',
            ],
        },
    ],
} as const;

/**
 * Scene 3 -- what the system does for you.
 *
 * The scrolling columns are the marquee from the source site, which listed a
 * client’s brand logos. Package names were the first thing tried here and they
 * read as a build log to anyone who does not work on this, and they did not fit
 * the cards either — the names were longer than the boxes. So the columns say
 * what the system does, in the same number of words a logo would have occupied.
 * The package names moved to the footer, where being read is the point.
 */
export const AGENT = {
    title: ['it reads its own', 'spending limit'],
    columns: [
        [
            { name: 'Checks what the agent may do', tone: 'green' },
            { name: 'Shows you the rules plainly', tone: 'lightblue' },
            { name: 'Watches the chain as it moves', tone: 'orange' },
            { name: 'Knows when to say no', tone: 'pink' },
        ],
        [
            { name: 'Follows orders it cannot rewrite', tone: 'maroon' },
            { name: 'Stops the moment you ask', tone: 'darkblue' },
            { name: 'Keeps a record you can check', tone: 'lightgreen' },
            { name: 'Refuses anything over the line', tone: 'green' },
        ],
    ],
} as const;

/**
 * The practical half.
 *
 * Everything above this page explains what the system does. Nothing on it said
 * how to run it -- which is the question a reader actually arrives with, and
 * the one the page was built to raise an answer to. The commands are the README's
 * in the README's order, because the order is load-bearing: without
 * `git submodule update` the contracts do not build, and without the four
 * private keys `g6` exits before it sends anything.
 *
 * Deliberately only the two G6 steps. `watch`, `explorer lineage` and
 * `seller-check` are one line of copy away in the README, and five steps of a
 * stranger's shell is a wall -- three is a door.
 */
export const USE_IT = {
    title: 'run it',
    titleAccent: 'yourself.',
    parts: [
        {
            name: 'AuthorityRegistry',
            what: 'the authority graph. revoking a parent kills the whole subtree, on chain.',
        },
        {
            name: '@mandat/envelope-cli',
            what: 'a SKILL.md becomes a delegation with caveats hashed into it.',
        },
        {
            name: '@mandat/three-light',
            what: 'the commitState gate. a resource is released only once the lamps light.',
        },
        {
            name: '@mandat/protocol',
            what: 'one encoding of the terms, shared by the contract, the CLI and the seller.',
        },
    ],
    steps: [
        {
            cmd: 'git submodule update --init --recursive',
            note: '12 pinned submodules. DTK and OpenZeppelin. Without them forge test does not build.',
        },
        {
            cmd: 'pnpm install',
            note: 'Needs Node 22 or newer, pnpm, and Foundry.',
        },
        {
            cmd: 'cp contracts/.env.example contracts/.env',
            note: 'That file is the authoritative one. Fill in the four private keys.',
        },
        {
            cmd: 'cd packages/authority-header && pnpm g6 within',
            note: '0.1 WMON against a 0.5 cap. Mined, succeeded, the balance moved.',
        },
        {
            cmd: 'pnpm g6 over',
            note: '0.8 WMON against the same cap. Mined, reverted. 900k gas, nothing moved.',
        },
    ],
    more: 'plus watch, explorer lineage and seller-check',
    readmeLabel: 'the full README',
    readmeHref: 'https://github.com/ZiramBayam/mandat#running-it',
    repoHref: 'https://github.com/ZiramBayam/mandat',
} as const;

/**
 * Scene 4 -- finality.
 *
 * The scrolling words are the four states, because that sequence is the spine of
 * the whole thing: nothing an agent acts on skips a step in it.
 */
export const FINALITY = {
    words: ['ASKED', 'AGREED', 'DONE', 'VERIFIED'],
    title: 'nothing moves',
    titleAccent: 'until the chain says so.',
    lampsLabel: 'live, from the chain',
    lampsBlurb: 'Read from a live Monad connection. Each step has its own shape as well as its own colour, so it reads without relying on colour.',
    footerNote:
        'Built for the Monad ecosystem. Everything here is on testnet: nothing is ' +
        'audited and nothing holds real value.',
} as const;

/**
 * Evidence.
 *
 * Recorded facts about transactions that already happened, so constants rather
 * than runtime reads. Shown as links so a reader can check any claim without
 * trusting this page.
 */
export const EVIDENCE = {
    g6Within: {
        label: 'Under the limit',
        value: '0x477436f2…530d357',
        href: 'https://testnet.monadvision.com/tx/0x477436f21f2162cb9db4ef15ab78565a89b6abaf979062370249c29cf530d357',
        outcome: 'success',
    },
    g6Over: {
        label: 'Over the limit',
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

/**
 * The package names, moved out of the marquee and into the footer.
 */
export const PACKAGES = [
    '@mandat/protocol',
    '@mandat/envelope-cli',
    '@mandat/three-light',
    '@mandat/authority-header',
    'AuthorityRegistry',
    'SkillAuthorityEnforcer',
] as const;