# The GitHub Pages redirect

The documentation used to be published to `dknowles2.github.io/trusty-track/`
and is now part of <https://trusty-track.com/> — the landing page at the root
and the guides under `/docs/`, built together by `scripts/build_site.sh` and
deployed by Cloudflare Pages.

The old address is not retired, because links to it exist in places nobody can
edit: earlier releases' READMEs, issue threads, search results. This directory
is what the `Deploy docs` workflow now pushes to the `gh-pages` branch instead
of the site — two files that send every visitor to the same page under the new
address, keeping the path, query and fragment.

`404.html` does the work: GitHub Pages serves it for any path it cannot find,
and the branch holds nothing else, so that is every path. `index.html` is the
same file, for the root.
