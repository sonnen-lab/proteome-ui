const BASE_CANDIDATES = [
    "https://raw.githubusercontent.com/MeijerW/Meijer-proteomics-data-main/main/Datafiles/",
    "https://raw.githubusercontent.com/MeijerW/Meijer-proteomics-data/main/Datafiles/"
]

let RNA_DATA = []
let PROT_DATA = []
let RHO_CORRELATION_DATA = new Map()
let DIFFERENTIALLY_EXPRESSED_GENES = new Set()
let ALIAS_MAP = new Map()
let CANONICAL_TO_ALIASES = new Map()
let DATA_READY = false
window.proteomeDataReady = false
const GENE_TO_ENSEMBL = { RNA: new Map(), PROTEIN: new Map() }
const ENSEMBL_TO_GENE = { RNA: new Map(), PROTEIN: new Map() }

const SPATIAL_DATASETS = {
    RNA: ["rna_long_harmonized_20260528.csv"],
    PROTEIN: ["prot_long_harmonized_20260528.csv"],
    RHO: ["correlation_eachprot_RNAnew.txt"],
    DE_LIST: ["heatmap_order_20260326.txt"],
    ALIASES: ["master_gene_alias_lookup_spatial+spatiotemporal_20260528.csv"]
}

function normalizeGeneKey(value){
    return String(value || "").trim().toLowerCase();
}

function registerAlias(query, canonical){
    const queryKey = normalizeGeneKey(query);
    const canonicalValue = String(canonical || "").trim();
    if(!queryKey || !canonicalValue) return;

    ALIAS_MAP.set(queryKey, canonicalValue);

    const canonicalKey = normalizeGeneKey(canonicalValue);
    if(!CANONICAL_TO_ALIASES.has(canonicalKey)){
        CANONICAL_TO_ALIASES.set(canonicalKey, new Set());
    }
    CANONICAL_TO_ALIASES.get(canonicalKey).add(canonicalValue);
    CANONICAL_TO_ALIASES.get(canonicalKey).add(String(query || "").trim());
}

function resolveGeneAlias(query){
    const trimmed = String(query || "").trim();
    if(!trimmed) return "";
    const key = normalizeGeneKey(trimmed);
    return ALIAS_MAP.get(key) || trimmed;
}

function getAliasAutocompleteList(){
    const names = new Set();
    CANONICAL_TO_ALIASES.forEach(aliasSet => {
        aliasSet.forEach(name => {
            const clean = String(name || "").trim();
            if(clean) names.add(clean);
        });
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function parseAliasCsv(text){
    const rows = Papa.parse(text, {
        header: true,
        dynamicTyping: false,
        skipEmptyLines: true
    }).data;

    rows.forEach(row => {
        const canonical = row.canonical || row.symbol || "";
        if(!canonical) return;

        registerAlias(canonical, canonical);

        const queryBuckets = [
            row.query_name,
            row.query,
            row.alias,
            row.aliases,
            row.aliases_joined,
            row.all_aliases
        ];

        queryBuckets.forEach(bucket => {
            String(bucket || "")
                .split(/[|,;]+/)
                .map(value => String(value || "").trim())
                .filter(Boolean)
                .forEach(alias => registerAlias(alias, canonical));
        });
    });
}

async function fetchFirstAvailable(candidates, label, required = true){
    const list = Array.isArray(candidates) ? candidates : [candidates];
    let lastStatus = "";

    for(const fileName of list){
        for(const base of BASE_CANDIDATES){
            const response = await fetch(base + fileName);
            if(response.ok){
                const text = await response.text();
                return {text, fileName};
            }
            lastStatus = `${base} -> HTTP ${response.status}`;
        }
    }

    if(required){
        throw new Error(`Failed to load ${label}. Tried: ${list.join(", ")} (${lastStatus || "unavailable"})`);
    }

    return null;
}

function cleanQuotedValue(value){
    return String(value || "").trim().replace(/^"|"$/g, "");
}

function parseRhoCorrelationText(text){
    const rhoMap = new Map();
    const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(line => line);

    lines.forEach((line, index) => {
        if(index === 0 && cleanQuotedValue(line).toLowerCase() === "diag") return;

        const parts = line.split('\t');
        if(parts.length < 2) return;

        const gene = cleanQuotedValue(parts[0]);
        const rhoValue = Number(parts[parts.length - 1]);
        if(!gene || Number.isNaN(rhoValue)) return;

        const canonicalGene = resolveGeneAlias(gene);
        rhoMap.set(gene.toLowerCase(), {
            gene: canonicalGene,
            value: rhoValue
        });
        rhoMap.set(String(canonicalGene).toLowerCase(), {
            gene: canonicalGene,
            value: rhoValue
        });
    });

    return rhoMap;
}

function parseDifferentialGeneList(text){
    const genes = new Set();
    String(text || "")
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line)
        .forEach(line => {
            // DE list may be a quoted index+gene table, e.g. "1"\t"Arhgap33".
            const quotedTokens = Array.from(line.matchAll(/"([^"]+)"/g)).map(match => String(match[1] || '').trim());
            let gene = '';

            if(quotedTokens.length > 0){
                // Prefer the last non-numeric quoted token, then fallback to the last quoted token.
                for(let idx = quotedTokens.length - 1; idx >= 0; idx -= 1){
                    if(/[a-zA-Z]/.test(quotedTokens[idx])){
                        gene = quotedTokens[idx];
                        break;
                    }
                }
                if(!gene) gene = quotedTokens[quotedTokens.length - 1] || '';
            } else {
                // Fallback for unquoted formats: split common delimiters and take the last token.
                const parts = line
                    .split(/[\t,]+|\s{2,}/)
                    .map(token => cleanQuotedValue(token))
                    .filter(Boolean);
                gene = parts.length > 0 ? parts[parts.length - 1] : cleanQuotedValue(line);
            }

            if(gene && String(gene).toLowerCase() !== 'x'){
                genes.add(String(gene).toLowerCase());
                const canonical = resolveGeneAlias(gene);
                if(canonical) genes.add(String(canonical).toLowerCase());
            }
        });
    return genes;
}

function getSpatialExpressionValue(row){
    const candidates = [
        row["Z-score"],
        row["Z_score"],
        row["z_score"],
        row["zscore"],
        row["ZScore"],
        row["zScore"],
        row.value,
        row.VALUE
    ];

    const match = candidates.find(value => value !== undefined && value !== null && value !== "");
    if(match === undefined) return NaN;

    const numericValue = Number(match);
    return Number.isNaN(numericValue) ? NaN : numericValue;
}

function parseSpatialCsv(text){
    const rows = Papa.parse(text, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true
    }).data;

    return rows.map(row => ({
        ID: resolveGeneAlias(row.Gene || row.gene || row.ID || row.id),
        group: row.group || row.Group || row.region || row.Region,
        sample: row.sample || row.Sample || null,
        replicate: row.replicate || row.Replicate || null,
        spatialValue: getSpatialExpressionValue(row)
    }));
}

function parseTimeAndReplicateFromSample(sampleValue){
    const sample = String(sampleValue || "").trim();
    const match = sample.match(/TP_(\d+)_REP_(\d+)/i);
    if(!match){
        return {time: null, replicate: null};
    }
    const time = Number(match[1]);
    const replicate = Number(match[2]);
    return {
        time: Number.isNaN(time) ? null : time,
        replicate: Number.isNaN(replicate) ? null : replicate
    };
}

function registerEnsemblMapping(dataset, gene, ensemblId){
    const geneKey = normalizeGeneKey(gene);
    const ensemblKey = String(ensemblId || "").trim();
    if(!geneKey || !ensemblKey) return;

    if(!GENE_TO_ENSEMBL[dataset].has(geneKey)) GENE_TO_ENSEMBL[dataset].set(geneKey, ensemblKey);
    if(!ENSEMBL_TO_GENE[dataset].has(ensemblKey)) ENSEMBL_TO_GENE[dataset].set(ensemblKey, String(gene || "").trim());
}

function resolveMatchedGene(gene, fromDataset, toDataset){
    const trimmed = String(gene || "").trim();
    const ensemblId = GENE_TO_ENSEMBL[fromDataset]?.get(normalizeGeneKey(trimmed));
    return ensemblId
        ? (ENSEMBL_TO_GENE[toDataset]?.get(ensemblId) || trimmed)
        : trimmed;
}

function parseWideTemporalCsv(text, region, dataset){
    const rows = Papa.parse(text, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true
    }).data;
    const output = [];

    rows.forEach(row => {
        const rawGene = row.ID ?? row.Gene ?? row.gene;
        if(rawGene === undefined || rawGene === null || rawGene === "") return;

        const gene = resolveGeneAlias(rawGene);
        const ensemblId = row.Ensembl_ID || row.ensembl_id || null;
        registerEnsemblMapping(dataset, gene, ensemblId);

        Object.keys(row)
            .filter(key => /^TP_\d+_REP_\d+$/i.test(key))
            .forEach(sample => {
                const value = row[sample];
                if(value === undefined || value === null || value === "") return;
                const parsed = parseTimeAndReplicateFromSample(sample);
                output.push({
                    ID: gene,
                    region,
                    group: region,
                    time: parsed.time,
                    sample,
                    replicate: parsed.replicate,
                    value,
                    ensemblId,
                    P_VALUE: row.P_VALUE,
                    Q_VALUE: row.Q_VALUE,
                    PERIOD: row.PERIOD,
                    LAG: row.LAG,
                    AMPLITUDE: row.AMPLITUDE,
                    OFFSET: row.OFFSET,
                    MEAN_PERIODICITY: row.MEAN_PERIODICITY,
                    SCATTER: row.SCATTER
                });
            });
    });

    return output;
}

async function loadData(){

// Load alias mappings first (optional, but enables flexible gene lookup)
const aliasFile = await fetchFirstAvailable(SPATIAL_DATASETS.ALIASES, "alias lookup", false)
if(aliasFile && aliasFile.text){
parseAliasCsv(aliasFile.text)
}

// Load pre-z-scored spatial data from CSV
const rnaCsv = await fetchFirstAvailable(SPATIAL_DATASETS.RNA, "spatial RNA CSV")
RNA_DATA = parseSpatialCsv(rnaCsv.text)

const protCsv = await fetchFirstAvailable(SPATIAL_DATASETS.PROTEIN, "spatial protein CSV")
PROT_DATA = parseSpatialCsv(protCsv.text)

const rhoFile = await fetchFirstAvailable(SPATIAL_DATASETS.RHO, "spatial rho file")
const rhoText = rhoFile.text
RHO_CORRELATION_DATA = parseRhoCorrelationText(rhoText)

const deFile = await fetchFirstAvailable(SPATIAL_DATASETS.DE_LIST, "DE gene list")
const deText = deFile.text
DIFFERENTIALLY_EXPRESSED_GENES = parseDifferentialGeneList(deText)

// Load spatiotemporal data from wide filtered CSV files and preserve metadata
const rnaFiles = [
    {
        urls: ["A_RNAseq_filtered.csv"],
        region: "a-psm"
    },
    {
        urls: ["P_RNAseq_filtered.csv"],
        region: "p-psm"
    },
    {
        urls: ["S_RNAseq_filtered.csv"],
        region: "Somite"
    }
]

for (const file of rnaFiles) {
    const loaded = await fetchFirstAvailable(file.urls, `spatiotemporal RNA ${file.region}`)
    RNA_DATA = RNA_DATA.concat(parseWideTemporalCsv(loaded.text, file.region, "RNA"))
}

// Protein files
const protFiles = [
    {
        urls: ["A_proteomics_filtered.csv"],
        region: "a-psm"
    },
    {
        urls: ["P_proteomics_filtered.csv"],
        region: "p-psm"
    },
    {
        urls: ["S_proteomics_filtered.csv"],
        region: "Somite"
    }
]

for (const file of protFiles) {
    const loaded = await fetchFirstAvailable(file.urls, `spatiotemporal protein ${file.region}`)
    PROT_DATA = PROT_DATA.concat(parseWideTemporalCsv(loaded.text, file.region, "PROTEIN"))
}

DATA_READY = true
window.proteomeDataReady = true
document.dispatchEvent(new CustomEvent("proteomeDataLoaded"))

}

loadData()

window.resolveGeneAlias = resolveGeneAlias;
window.getAliasAutocompleteList = getAliasAutocompleteList;
window.resolveMatchedGene = resolveMatchedGene;