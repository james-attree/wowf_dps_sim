// The reference build and the build-link decoder moved to
// data/reference-build.js (#151), so the page can offer the build without
// importing from test/. Tests and benches keep importing them from here.
export {
  decodeBuildLink,
  REFERENCE_LINK,
  referenceBuild,
} from "../data/reference-build.js";
