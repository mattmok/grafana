import uFuzzy from '@leeoniya/ufuzzy';

import { DataFrameView, SelectableValue, ArrayVector } from '@grafana/data';
import { TermCount } from 'app/core/components/TagFilter/TagFilter';

import { DashboardQueryResult, GrafanaSearcher, QueryResponse, SearchQuery } from '.';

export class FrontendSearcher implements GrafanaSearcher {
  readonly cache = new Map<string, Promise<FullResultCache>>();

  constructor(private parent: GrafanaSearcher) {}

  async search(query: SearchQuery): Promise<QueryResponse> {
    if (query.facet?.length) {
      throw new Error('facets not supported!');
    }

    // we don't yet support anything except default (relevance)
    if (query.sort != null) {
      throw new Error('custom sorting is not supported yet');
    }

    // Don't bother... not needed for this exercise
    if (query.tags?.length || query.ds_uid?.length) {
      return this.parent.search(query);
    }

    // TODO -- make sure we refresh after a while
    const all = await this.getCache(query.kind);
    const view = all.search(query.query);
    return {
      isItemLoaded: () => true,
      loadMoreItems: async (startIndex: number, stopIndex: number): Promise<void> => {},
      totalRows: view.length,
      view,
    };
  }

  async getCache(kind?: string[]): Promise<FullResultCache> {
    const key = kind ? kind.sort().join(',') : '*';

    const cacheHit = this.cache.get(key);
    if (cacheHit) {
      try {
        return await cacheHit;
      } catch (e) {
        // delete the cache key so that the next request will retry
        this.cache.delete(key);
        return new FullResultCache(new DataFrameView({ name: 'error', fields: [], length: 0 }));
      }
    }

    const resultPromise = this.parent
      .search({
        kind, // match the request
        limit: 5000, // max for now
      })
      .then((res) => new FullResultCache(res.view));

    this.cache.set(key, resultPromise);
    return resultPromise;
  }

  async starred(query: SearchQuery): Promise<QueryResponse> {
    return this.parent.starred(query);
  }

  sortPlaceholder = 'Default (Relevance)';

  // returns the appropriate sorting options
  async getSortOptions(): Promise<SelectableValue[]> {
    return this.parent.getSortOptions();
  }

  async tags(query: SearchQuery): Promise<TermCount[]> {
    return this.parent.tags(query);
  }
}

class FullResultCache {
  readonly names: string[];
  empty: DataFrameView<DashboardQueryResult>;

  ufuzzy = new uFuzzy({
    intraMode: 1,
    intraIns: 1,
    intraSub: 1,
    intraTrn: 1,
    intraDel: 1,
  });

  constructor(private full: DataFrameView<DashboardQueryResult>) {
    this.names = this.full.fields.name.values.toArray();

    // Copy with empty values
    this.empty = new DataFrameView<DashboardQueryResult>({
      ...this.full.dataFrame, // copy folder metadata
      fields: this.full.dataFrame.fields.map((v) => ({ ...v, values: new ArrayVector([]) })),
      length: 0, // for now
    });
  }

  // single instance that is mutated for each response (not great, but OK for now)
  search(query?: string): DataFrameView<DashboardQueryResult> {
    if (!query?.length || query === '*') {
      return this.full;
    }

    const allFields = this.full.dataFrame.fields;
    const haystack = this.names;

    // eslint-disable-next-line
    const values = allFields.map((v) => [] as any[]); // empty value for each field

    // out-of-order terms
    const oooIdxs = new Set<number>();
    const queryTerms = this.ufuzzy.split(query);
    const oooNeedles = uFuzzy.permute(queryTerms).map((terms) => terms.join(' '));

    oooNeedles.forEach((needle) => {
      let idxs = this.ufuzzy.filter(haystack, needle);
      let info = this.ufuzzy.info(idxs, haystack, needle);
      let order = this.ufuzzy.sort(info, haystack, needle);

      for (let i = 0; i < order.length; i++) {
        let haystackIdx = info.idx[order[i]];

        if (!oooIdxs.has(haystackIdx)) {
          oooIdxs.add(haystackIdx);

          for (let c = 0; c < allFields.length; c++) {
            values[c].push(allFields[c].values.get(haystackIdx));
          }
        }
      }
    });

    // mutates the search object
    this.empty.dataFrame.fields.forEach((f, idx) => {
      f.values = new ArrayVector(values[idx]); // or just set it?
    });
    this.empty.dataFrame.length = this.empty.dataFrame.fields[0].values.length;

    return this.empty;
  }
}
