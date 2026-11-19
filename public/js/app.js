document.addEventListener("DOMContentLoaded", function() {
      const headers = document.querySelectorAll("th.sortable");

      headers.forEach(th => {
        th.addEventListener("click", function() {
          const table = th.closest("table");
          const tbody = table.querySelector("tbody");
          const rows = Array.from(tbody.querySelectorAll("tr"));

          const index = Array.from(
            th.parentNode.children
          ).indexOf(th);

          const isAscending = th.classList.contains("desc");

          headers.forEach(header => {
            header.classList.remove("asc", "desc");
          });

          th.classList.add(isAscending ? "asc" : "desc");

          const numericColumns = [0, 2, 3, 4, 5, 6];

          rows.sort((a, b) => {
            const aText = a.children[index].innerText.trim();
            const bText = b.children[index].innerText.trim();

            if (numericColumns.includes(index)) {
              const aNum = Number(
                aText.replace(/[^0-9.-]+/g, "")
              );

              const bNum = Number(
                bText.replace(/[^0-9.-]+/g, "")
              );

              return isAscending
                ? aNum - bNum
                : bNum - aNum;
            }

            return isAscending
              ? aText.localeCompare(bText, "tr")
              : bText.localeCompare(aText, "tr");
          });

          rows.forEach(row => tbody.appendChild(row));
        });
      });
    });
