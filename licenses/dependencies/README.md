# License text omitted from npm packages

`cache-content-type@1.0.1` declares MIT in its published `package.json`, but its npm archive omits a license file and its README does not reproduce the license. `cache-content-type@1.0.1.LICENSE` preserves the license from the project's upstream repository:

https://raw.githubusercontent.com/node-modules/cache-content-type/master/LICENSE

Retrieved on 2026-10-25. The upstream notice covers 2018-present node-modules and contributors. The build includes this text only when the exact `cache-content-type@1.0.1` package is present in the esbuild input graph and the npm package has no license text. Changing that version requires reviewing the source and adding a corresponding override, rather than silently substituting another dependency's license.
