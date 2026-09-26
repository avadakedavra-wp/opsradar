// @ts-nocheck
import * as __fd_glob_7 from "../content/docs/seed-cluster.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/quickstart.mdx?collection=docs"
import * as __fd_glob_5 from "../content/docs/index.mdx?collection=docs"
import * as __fd_glob_4 from "../content/docs/helm-deploy.mdx?collection=docs"
import * as __fd_glob_3 from "../content/docs/github-detection.mdx?collection=docs"
import * as __fd_glob_2 from "../content/docs/configuration.mdx?collection=docs"
import * as __fd_glob_1 from "../content/docs/api-reference.mdx?collection=docs"
import { default as __fd_glob_0 } from "../content/docs/meta.json?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();

export const docs = await create.docs("docs", "content/docs", {"meta.json": __fd_glob_0, }, {"api-reference.mdx": __fd_glob_1, "configuration.mdx": __fd_glob_2, "github-detection.mdx": __fd_glob_3, "helm-deploy.mdx": __fd_glob_4, "index.mdx": __fd_glob_5, "quickstart.mdx": __fd_glob_6, "seed-cluster.mdx": __fd_glob_7, });