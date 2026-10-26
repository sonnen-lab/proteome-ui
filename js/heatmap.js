function heatmap(matrix,genes,times){

let data=[{

z:matrix,
x:times,
y:genes,
type:"heatmap",
colorscale:"Viridis"

}]

Plotly.newPlot("plot",data,{
title:"Expression Heatmap",
height: 600,
xaxis: {type: 'category'},
autosize: true,
margin: {b: 85},
annotations: [{
text: FIGURE_CITATION,
x: 0,
y: -0.16,
xref: "paper",
yref: "paper",
xanchor: "left",
yanchor: "top",
showarrow: false,
font: {size: 10, color: "#444444"},
align: "left"
}]
}, {
responsive: true
})

}
