const { ChromaVectorStore } = require('./packages/retrieval/dist/index');
const { OpenAILLMProvider, EmbeddingPipeline } = require('./packages/generation/dist/index');
const { SemanticChunker } = require('./packages/data-ingestion/dist/index');

async function indexTestData() {
  console.log('Initializing components...');

  const vectorStore = new ChromaVectorStore('localhost', 8000);
  await vectorStore.initialize();

  const llmProvider = new OpenAILLMProvider('http://localhost:1234');
  const embeddingPipeline = new EmbeddingPipeline(llmProvider);
  const chunker = new SemanticChunker(llmProvider);

  console.log('Indexing test document...');

  const testContent = `This is a test document for the RAG Documentation Assistant.`;

  try {
    const chunks = await chunker.chunk(testContent);
    const enrichedChunks = chunks.map(chunk => ({
      ...chunk,
      pageId: 'test-page-1',
      space: 'TEST',
      title: 'Test Documentation'
    }));

    const embeddedChunks = await embeddingPipeline.generateAndNormalizeEmbeddings(enrichedChunks);
    await vectorStore.addChunks(embeddedChunks);

    console.log(`Successfully indexed ${embeddedChunks.length} chunks`);
  } catch (error) {
    console.error('Error indexing test data:', error);
  }
}

indexTestData();