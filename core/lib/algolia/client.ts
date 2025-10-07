import { algoliasearch } from 'algoliasearch';
 
if (!process.env.ALGOLIA_APPLICATION_ID) {
  throw new Error('ALGOLIA_APPLICATION_ID is required');
}
 
if (!process.env.ALGOLIA_SEARCH_API_KEY) {
  throw new Error('ALGOLIA_SEARCH_API_KEY is not set');
}
 
const algoliaClient = algoliasearch(
  process.env.ALGOLIA_APPLICATION_ID,
  process.env.ALGOLIA_SEARCH_API_KEY
);
 
export default algoliaClient;