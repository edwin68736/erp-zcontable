package main

import (
	"fmt"
	"net/http"
)

func handler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "API ZContables funcionando")
}

func main() {
	http.HandleFunc("/", handler)

	fmt.Println("Servidor corriendo en puerto 8080")

	err := http.ListenAndServe(":8080", nil)

	if err != nil {
		panic(err)
	}
}