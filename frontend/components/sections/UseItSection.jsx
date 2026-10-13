'use client';

/**
 * "Run it yourself."
 *
 * The last section, and the only one that tells the reader what to type. Every
 * other section argues that the system is real -- the pages above say an agent
 * holds an envelope rather than a key, and the evidence chips carry two
 * transactions that can be opened. None of that says how to reproduce it, and a
 * reader who cannot get to that point has been told about a project rather than
 * handed one.
 *
 * The layout borrows from the sections above rather than inventing anything:
 * .title-container and .main-title for the heading, .card-list for the diamond
 * bullets on the parts. The only new styling is the command column.
 *
 * Order matters and is copied from the README rather than chosen here. The
 * submodules are what make the contracts build; the four keys in
 * contracts/.env are what `g6` refuses to run without. Put either one later and
 * the reader hits an error before seeing a single transaction.
 */

import { USE_IT } from '@/lib/content';

export default function UseItSection() {
    return (
        <section className="use-it" id="use-it">
            <div className="title-container">
                <h2 className="main-title">
                    {USE_IT.title} <span className="italic-text">{USE_IT.titleAccent}</span>
                </h2>
            </div>

            <div className="use-it__grid">
                <div className="use-it__col use-it__col--parts">
                    <h3 className="use-it__subhead">what is in the box</h3>
                    <ul className="card-list use-it__parts">
                        {USE_IT.parts.map((part) => (
                            <li key={part.name}>
                                <div>
                                    <span className="use-it__part-name">{part.name}</span>
                                    <span className="use-it__part-what">{part.what}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                    <p className="use-it__footnote">
                        The four packages are not on npm. Clone the repo and read the code.
                    </p>
                </div>

                <div className="use-it__col use-it__col--steps">
                    <h3 className="use-it__subhead">produce the evidence pair</h3>
                    <ol className="use-it__steps">
                        {USE_IT.steps.map((step) => (
                            <li key={step.cmd} className="use-it__step">
                                <code className="use-it__cmd">{step.cmd}</code>
                                <span className="use-it__note">{step.note}</span>
                            </li>
                        ))}
                    </ol>
                    <p className="use-it__more">
                        {USE_IT.more} —{' '}
                        <a href={USE_IT.readmeHref} target="_blank" rel="noreferrer">
                            {USE_IT.readmeLabel}
                        </a>
                        {' · '}
                        <a href={USE_IT.repoHref} target="_blank" rel="noreferrer">
                            source
                        </a>
                    </p>
                </div>
            </div>
        </section>
    );
}