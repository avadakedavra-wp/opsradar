// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {"api-reference.mdx": () => import("../content/docs/api-reference.mdx?collection=docs"), "cluster.mdx": () => import("../content/docs/cluster.mdx?collection=docs"), "configuration.mdx": () => import("../content/docs/configuration.mdx?collection=docs"), "github-detection.mdx": () => import("../content/docs/github-detection.mdx?collection=docs"), "github.mdx": () => import("../content/docs/github.mdx?collection=docs"), "helm-deploy.mdx": () => import("../content/docs/helm-deploy.mdx?collection=docs"), "index.mdx": () => import("../content/docs/index.mdx?collection=docs"), "quickstart.mdx": () => import("../content/docs/quickstart.mdx?collection=docs"), "seed-cluster.mdx": () => import("../content/docs/seed-cluster.mdx?collection=docs"), }),
};
export default browserCollections;